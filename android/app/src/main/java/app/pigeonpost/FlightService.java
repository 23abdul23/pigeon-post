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

    private static final String CHANNEL_ID = "flight";
    private static final int NOTIFICATION_ID = 1001;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable autoStop = this::stopSelf;
    private boolean foregrounded = false;
    private BroadcastReceiver screenReceiver;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            // Restarted by the system without our extras: nothing to show, so do not linger.
            stopSelf();
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
            .setSmallIcon(R.mipmap.ic_launcher)
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
            FlightPlugin.emit("endRequested");
        }
    }
}
