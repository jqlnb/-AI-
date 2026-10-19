package com.studyplanner.app;

import android.app.Notification;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.text.TextUtils;
import org.json.JSONArray;
import org.json.JSONObject;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;

public class NotificationCaptureService extends NotificationListenerService {
    static final String PREFS = "study_notification_capture";
    private static volatile NotificationCaptureService instance;

    @Override public void onListenerConnected() {
        super.onListenerConnected();
        instance = this;
        captureActiveNotifications();
    }

    @Override public void onListenerDisconnected() {
        instance = null;
        super.onListenerDisconnected();
    }

    static int captureActiveNotifications() {
        NotificationCaptureService service = instance;
        if (service == null) return 0;
        try {
            StatusBarNotification[] active = service.getActiveNotifications();
            if (active == null) return 0;
            int captured = 0;
            for (StatusBarNotification notification : active) if (service.capture(notification)) captured++;
            return captured;
        } catch (Exception ignored) { return 0; }
    }

    @Override public void onNotificationPosted(StatusBarNotification sbn) { capture(sbn); }

    private boolean capture(StatusBarNotification sbn) {
        try {
            android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            String packageName = sbn.getPackageName();
            if (getPackageName().equals(packageName)) return false;
            JSONArray detected = new JSONArray(prefs.getString("detected", "[]"));
            boolean exists = false;
            for (int i = 0; i < detected.length(); i++) if (packageName.equals(detected.getJSONObject(i).optString("packageName"))) exists = true;
            if (!exists) {
                String label = packageName;
                try { label = getPackageManager().getApplicationLabel(getPackageManager().getApplicationInfo(packageName, 0)).toString(); } catch (PackageManager.NameNotFoundException ignored) { }
                detected.put(new JSONObject().put("packageName", packageName).put("label", label));
                if (detected.length() > 40) detected.remove(0);
                prefs.edit().putString("detected", detected.toString()).apply();
            }
            if (!prefs.getBoolean("enabled", false)) return false;
            Set<String> allowed = new HashSet<>(prefs.getStringSet("allowed", new HashSet<>()));
            if (!allowed.contains(packageName)) return false;
            Bundle extras = sbn.getNotification().extras;
            if (extras == null) return false;
            CharSequence titleValue = extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence bodyValue = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
            if (TextUtils.isEmpty(bodyValue)) bodyValue = extras.getCharSequence(Notification.EXTRA_TEXT);
            if (TextUtils.isEmpty(bodyValue)) {
                CharSequence[] lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
                if (lines != null && lines.length > 0) {
                    StringBuilder joined = new StringBuilder();
                    for (CharSequence line : lines) if (!TextUtils.isEmpty(line)) {
                        if (joined.length() > 0) joined.append('\n');
                        joined.append(line);
                    }
                    bodyValue = joined;
                }
            }
            String title = titleValue == null ? "" : titleValue.toString().trim();
            String body = bodyValue == null ? "" : bodyValue.toString().trim();
            if (title.isEmpty() && body.isEmpty()) return false;
            String stableId = sha256(packageName + "|" + sbn.getKey());
            JSONArray queue = new JSONArray(prefs.getString("queue", "[]"));
            for (int i = 0; i < queue.length(); i++) if (stableId.equals(queue.getJSONObject(i).optString("id"))) return false;
            queue.put(new JSONObject().put("id", stableId).put("packageName", packageName).put("title", title).put("body", body).put("postedAt", sbn.getPostTime()));
            while (queue.length() > 50) queue.remove(0);
            prefs.edit().putString("queue", queue.toString()).putLong("lastCapturedAt", sbn.getPostTime()).apply();
            NotificationCapturePlugin.notifyCaptureAvailable();
            return true;
        } catch (Exception ignored) { /* Notification contents are intentionally never logged. */ }
        return false;
    }
    private String sha256(String value) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder(); for (byte b : bytes) result.append(String.format("%02x", b)); return result.toString();
    }
}
