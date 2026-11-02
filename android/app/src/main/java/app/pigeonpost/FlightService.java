package app.pigeonpost;

import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Keeps the process alive while a flight runs and reports screen on/off to JS (via FlightPlugin).
 * Starting it again while it runs only refreshes the notification and the auto-stop timer.
 */
public class FlightService extends Service {

    static final String EXTRA_TITLE = "title";
    static final String EXTRA_TEXT = "text";
    static final String EXTRA_ENDS_AT_MS = "endsAtMs";
    static final String ACTION_END_FLIGHT = "app.pigeonpost.action.END_FLIGHT";

    static final String ACTION_STOP = "app.pigeonpost.action.STOP";

    /**
     * True once the service has called startForeground for a flight, until onDestroy. While true, a refresh only
     * re-posts the notification and a stop uses stopService, so neither needs startForegroundService (which the
     * system refuses from the background on API 31+).
     */
    static volatile boolean running = false;

    /**
     * True from the plugin's startForegroundService request until onStartCommand has called startForeground (or the
     * request failed). A stop in this window must go through ACTION_STOP, because stopping a service that was begun
     * with startForegroundService before it calls startForeground crashes the app.
     */
    static volatile boolean starting = false;

    /** The live service, for refresh(); set in onCreate, cleared in onDestroy. */
    private static volatile FlightService current;

    private static final String CHANNEL_ID = "flight";
    private static final int NOTIFICATION_ID = 1001;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable autoStop = this::stopSelf;
    private boolean foregrounded = false;
    private BroadcastReceiver screenReceiver;
    /** Whether "screenOn" has been sent since the last "screenOff", so SCREEN_ON and USER_PRESENT do not both send it. */
    private boolean screenOnSent = true;

    @Override
    public void onCreate() {
        super.onCreate();
        current = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            // Stop request, or a system restart without our extras: nothing to show, so do not linger.
            stopNow();
            return START_NOT_STICKY;
        }
        String title = intent.getStringExtra(EXTRA_TITLE);
        String text = intent.getStringExtra(EXTRA_TEXT);
        long endsAtMs = intent.getLongExtra(EXTRA_ENDS_AT_MS, 0L);

        ensureChannel();
        Notification notification = buildNotification(title == null ? "" : title, text == null ? "" : text, endsAtMs);
        if (!foregrounded) {
            int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0;
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type);
            foregrounded = true;
        } else {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIFICATION_ID, notification);
        }
        // Set running before clearing starting so a concurrent stop never sees both false while we are foreground.
        running = true;
        starting = false;

        registerScreenReceiver();
        scheduleAutoStop(endsAtMs);
        return START_NOT_STICKY;
    }

    private void scheduleAutoStop(long endsAtMs) {
        handler.removeCallbacks(autoStop);
        if (endsAtMs > 0) {
            long delay = endsAtMs - System.currentTimeMillis();
            handler.postDelayed(autoStop, Math.max(delay, 0L));
        }
    }

    /**
     * Updates a running flight's notification and auto-stop time without startForegroundService. Returns false when
     * no service is running (the caller then starts one). Any thread; the work runs on the main looper.
     */
    static boolean refresh(Context context, String title, String text, long endsAtMs) {
        FlightService svc = current;
        if (!running || svc == null) return false;
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return false;
        Notification notification = svc.buildNotification(title == null ? "" : title, text == null ? "" : text, endsAtMs);
        nm.notify(NOTIFICATION_ID, notification);
        svc.handler.post(() -> {
            if (current == svc) svc.scheduleAutoStop(endsAtMs);
        });
        return true;
    }

    /**
     * Stops the service safely. A service begun with startForegroundService must call startForeground before it
     * stops, otherwise the system crashes the app, so do that first if it has not happened yet.
     */
    private void stopNow() {
        if (!foregrounded) {
            ensureChannel();
            int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0;
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification("", "", 0L), type);
            foregrounded = true;
        }
        handler.removeCallbacks(autoStop);
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    /**
     * Stops the flight service. Running: stopService, which is allowed from the background. Still starting (the
     * service has not called startForeground yet): ACTION_STOP, so it calls startForeground before stopping. Neither:
     * a no-op. Safe to call repeatedly.
     */
    static void requestStop(Context context) {
        if (running) {
            context.stopService(new Intent(context, FlightService.class));
            return;
        }
        if (starting) {
            Intent stop = new Intent(context, FlightService.class).setAction(ACTION_STOP);
            ContextCompat.startForegroundService(context, stop);
        }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // The app task was swiped away: nothing in JS can end the flight any more.
        stopNow();
        super.onTaskRemoved(rootIntent);
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Flight", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shown while a focus flight is running");
        nm.createNotificationChannel(channel);
    }

    private Notification buildNotification(String title, String text, long endsAtMs) {
        Intent open = new Intent(this, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        PendingIntent endIntent = PendingIntent.getBroadcast(
            this, 1, new Intent(this, FlightService.FlightEndReceiver.class).setAction(ACTION_END_FLIGHT),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_flight)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setContentIntent(contentIntent)
            .addAction(0, "End flight", endIntent);
        if (endsAtMs > 0) {
            // Countdown only when the end is known.
            b.setShowWhen(true).setWhen(endsAtMs).setUsesChronometer(true).setChronometerCountDown(true);
        } else {
            b.setShowWhen(false);
        }
        return b.build();
    }

    private void registerScreenReceiver() {
        if (screenReceiver != null) return;
        screenReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null) return;
                String action = intent.getAction();
                if (Intent.ACTION_SCREEN_OFF.equals(action)) {
                    screenOnSent = false;
                    FlightPlugin.emit("screenOff");
                } else if (Intent.ACTION_USER_PRESENT.equals(action)) {
                    // The keyguard was dismissed: the person is really back on the phone.
                    sendScreenOn();
                } else if (Intent.ACTION_SCREEN_ON.equals(action) && !isKeyguardLocked(context)) {
                    // The screen lights at the keyguard too (PIN entry, an incoming notification). JS treats screenOn
                    // with our page hidden as leaving, so only send it when there is no keyguard to get past.
                    sendScreenOn();
                }
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_SCREEN_ON);
        filter.addAction(Intent.ACTION_USER_PRESENT);
        ContextCompat.registerReceiver(this, screenReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    private void sendScreenOn() {
        if (screenOnSent) return;
        screenOnSent = true;
        FlightPlugin.emit("screenOn");
    }

    private static boolean isKeyguardLocked(Context context) {
        KeyguardManager km = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        return km != null && km.isKeyguardLocked();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(autoStop);
        if (screenReceiver != null) {
            try {
                unregisterReceiver(screenReceiver);
            } catch (IllegalArgumentException ignored) {
                // already unregistered
            }
            screenReceiver = null;
        }
        foregrounded = false;
        running = false;
        starting = false;
        if (current == this) current = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /** Receives the notification's "End flight" tap and forwards it to JS; JS then calls stop(). */
    public static class FlightEndReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (FlightPlugin.hasInstance()) {
                FlightPlugin.emit("endRequested");
            } else {
                // No JS to handle it (task was removed): end the flight ourselves.
                requestStop(context);
            }
        }
    }
}
