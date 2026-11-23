package com.worldofsimulators.app;

import android.os.Bundle;
import android.util.Log;

import androidx.browser.customtabs.CustomTabsCallback;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

/**
 * GOVRP TWA launcher. The Android Browser Helper QualityEnforcer deliberately
 * throws an uncaught RuntimeException on a browser quality_enforcement.crash
 * callback. On some Chrome / Android combinations that closes the entire app
 * instead of showing the site. Keep provider diagnostics, but do not crash
 * the host process: the browser will still enforce its own origin validation.
 */
public class MainActivity extends LauncherActivity {
    private static final String TAG = "GOVRP_TWA";

    @Override
    protected CustomTabsCallback getCustomTabsCallback() {
        return new CustomTabsCallback() {
            @Override
            public void extraCallback(String callbackName, Bundle args) {
                if ("quality_enforcement.crash".equals(callbackName)) {
                    Log.e(TAG, "O navegador relatou falha de qualidade da TWA. " +
                        "Verifique HTTPS, assetlinks.json, certificado de assinatura e PWA.");
                    return; // Do not deliberately throw RuntimeException.
                }
                super.extraCallback(callbackName, args);
            }
        };
    }
}
