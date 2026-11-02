package app.pigeonpost;

import android.content.Context;
import android.content.Intent;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import androidx.core.content.ContextCompat;

/** Capacitor plugin "Flight": starts/stops FlightService and relays its events to JS. */
@CapacitorPlugin(name = "Flight")
public class FlightPlugin extends Plugin {

    // The service (and the end-flight receiver) live outside the activity, so they reach the plugin through this.
    private static volatile FlightPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
    }

    /** Emits an event to JS if the plugin is currently loaded; otherwise drops it. */
    static void emit(String event) {
        FlightPlugin plugin = instance;
        if (plugin != null) plugin.notifyListeners(event, null);
    }

    @PluginMethod
    public void start(PluginCall call) {
        String title = call.getString("title", "");
        String text = call.getString("text", "");
        Double endsAt = call.getDouble("endsAtMs", 0d);
        long endsAtMs = endsAt == null ? 0L : endsAt.longValue();
        try {
            Context context = getContext();
            Intent intent = new Intent(context, FlightService.class)
                .putExtra(FlightService.EXTRA_TITLE, title)
                .putExtra(FlightService.EXTRA_TEXT, text)
                .putExtra(FlightService.EXTRA_ENDS_AT_MS, endsAtMs);
            ContextCompat.startForegroundService(context, intent);
            call.resolve();
        } catch (RuntimeException e) {
            call.reject("Could not start the flight service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            Context context = getContext();
            context.stopService(new Intent(context, FlightService.class));
            call.resolve();
        } catch (RuntimeException e) {
            call.reject("Could not stop the flight service: " + e.getMessage());
        }
    }
}
