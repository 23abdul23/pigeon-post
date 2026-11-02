package app.pigeonpost;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FlightPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
