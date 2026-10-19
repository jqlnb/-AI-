package com.studyplanner.app;

import android.content.Intent;
import android.provider.Settings;
import android.text.TextUtils;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import java.util.HashSet;
import java.util.Set;

@CapacitorPlugin(name = "NotificationCapture")
public class NotificationCapturePlugin extends Plugin {
    private static volatile NotificationCapturePlugin instance;
    @Override public void load() { instance = this; }
    static void notifyCaptureAvailable() { NotificationCapturePlugin plugin = instance; if (plugin != null) plugin.notifyListeners("notificationCaptured", new JSObject()); }
    private boolean accessGranted() {
        String enabled = Settings.Secure.getString(getContext().getContentResolver(), "enabled_notification_listeners");
        return !TextUtils.isEmpty(enabled) && enabled.contains(getContext().getPackageName() + "/" + NotificationCaptureService.class.getName());
    }
    @PluginMethod public void getState(PluginCall call) {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences(NotificationCaptureService.PREFS, 0);
        JSObject result = new JSObject(); result.put("authorized", accessGranted()); result.put("enabled", prefs.getBoolean("enabled", false));
        result.put("lastProcessedAt", prefs.getLong("lastProcessedAt", 0)); result.put("lastCapturedAt", prefs.getLong("lastCapturedAt", 0)); result.put("allowedPackages", new org.json.JSONArray(prefs.getStringSet("allowed", new HashSet<>())));
        try { result.put("detectedApps", new JSArray(prefs.getString("detected", "[]"))); } catch (Exception ignored) { result.put("detectedApps", new JSArray()); }
        call.resolve(result);
    }
    @PluginMethod public void openAccessSettings(PluginCall call) {
        try { getActivity().startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)); call.resolve(); }
        catch (Exception error) { call.reject("无法打开 Android 通知读取设置。", error); }
    }
    @PluginMethod public void setConfiguration(PluginCall call) {
        JSArray packages = call.getArray("allowedPackages", new JSArray()); Set<String> allowed = new HashSet<>();
        for (int i=0; i<packages.length(); i++) { String value = packages.optString(i, ""); if (!value.isEmpty()) allowed.add(value); }
        boolean enabled = call.getBoolean("enabled", false);
        android.content.SharedPreferences.Editor editor = getContext().getSharedPreferences(NotificationCaptureService.PREFS, 0).edit().putBoolean("enabled", enabled).putStringSet("allowed", allowed);
        if (!enabled || allowed.isEmpty()) editor.putString("queue", "[]");
        editor.apply(); call.resolve();
    }
    @PluginMethod public void takeQueue(PluginCall call) {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences(NotificationCaptureService.PREFS, 0);
        String raw = prefs.getString("queue", "[]");
        try { JSObject result = new JSObject(); result.put("notifications", new JSArray(raw)); call.resolve(result); }
        catch (Exception error) { call.reject("读取通知队列失败。", error); }
    }
    @PluginMethod public void scanActiveNotifications(PluginCall call) {
        if (!accessGranted()) { call.reject("尚未授权 Android 通知读取权限。"); return; }
        JSObject result = new JSObject();
        result.put("queued", NotificationCaptureService.captureActiveNotifications());
        call.resolve(result);
    }
    @PluginMethod public void clearQueue(PluginCall call) {
        getContext().getSharedPreferences(NotificationCaptureService.PREFS, 0).edit().putString("queue", "[]").apply(); call.resolve();
    }
    @PluginMethod public void markProcessed(PluginCall call) {
        getContext().getSharedPreferences(NotificationCaptureService.PREFS, 0).edit().putLong("lastProcessedAt", call.getLong("at", System.currentTimeMillis())).apply();
        call.resolve();
    }
}
