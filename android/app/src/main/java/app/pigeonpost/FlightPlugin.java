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

    static boolean hasInstance() {
        return instance != null;
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
        // getDouble() drops whole-number epoch times (org.json parses them as Long), so read the raw value.
        Object rawEndsAt = call.getData().opt("endsAtMs");
        long endsAtMs = rawEndsAt instanceof Number ? ((Number) rawEndsAt).longValue() : 0L;
        try {
            Context context = getContext();
            Intent intent = new Intent(context, FlightService.class)
                .putExtra(FlightService.EXTRA_TITLE, title)
                .putExtra(FlightService.EXTRA_TEXT, text)
                .putExtra(FlightService.EXTRA_ENDS_AT_MS, endsAtMs);
            FlightService.requested.set(true);
            ContextCompat.startForegroundService(context, intent);
            call.resolve();
        } catch (RuntimeException e) {
            FlightService.requested.set(false);
            call.reject("Could not start the flight service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            FlightService.requestStop(getContext());
            call.resolve();
        } catch (RuntimeException e) {
            call.reject("Could not stop the flight service: " + e.getMessage());
        }
    }
}
