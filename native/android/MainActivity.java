package com.lioryosub.pdftoolkit;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * Replaces the one `npx cap add android` generates, purely to register the
 * app's own plugin. A plugin that lives in the app rather than in a package has
 * to be named here, before the bridge starts.
 *
 * Copied into the generated project by scripts/build-android.mjs.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DocumentStorePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
