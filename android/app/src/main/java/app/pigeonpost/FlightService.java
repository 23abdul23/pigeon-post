package app.pigeonpost;

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
import java.util.concurrent.atomic.AtomicBoolean;
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

    /** True from the plugin's start() until this service is destroyed; stop() is a no-op while false. */
    static final AtomicBoolean requested = new AtomicBoolean(false);

    private static final String CHANNEL_ID = "flight";
    private static final int NOTIFICATION_ID = 1001;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable autoStop = this::stopSelf;
    private boolean foregrounded = false;
    private BroadcastReceiver screenReceiver;

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

        registerScreenReceiver();

        handler.removeCallbacks(autoStop);
        if (endsAtMs > 0) {
            long delay = endsAtMs - System.currentTimeMillis();
            handler.postDelayed(autoStop, Math.max(delay, 0L));
        }
        return START_NOT_STICKY;
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

    /** Asks a running service to stop; a no-op when no start was requested. Safe to call repeatedly. */
    static void requestStop(Context context) {
        if (!requested.get()) return;
        Intent stop = new Intent(context, FlightService.class).setAction(ACTION_STOP);
        ContextCompat.startForegroundService(context, stop);
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
                if (Intent.ACTION_SCREEN_OFF.equals(action)) FlightPlugin.emit("screenOff");
                else if (Intent.ACTION_SCREEN_ON.equals(action)) FlightPlugin.emit("screenOn");
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_SCREEN_ON);
        ContextCompat.registerReceiver(this, screenReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
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
        requested.set(false);
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
