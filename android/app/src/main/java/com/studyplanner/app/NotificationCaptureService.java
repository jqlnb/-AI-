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
    @Override public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            String packageName = sbn.getPackageName();
            if (getPackageName().equals(packageName)) return;
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
            if (!prefs.getBoolean("enabled", false)) return;
            Set<String> allowed = new HashSet<>(prefs.getStringSet("allowed", new HashSet<>()));
            if (!allowed.contains(packageName)) return;
            Bundle extras = sbn.getNotification().extras;
            if (extras == null) return;
            CharSequence titleValue = extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence bodyValue = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
            if (TextUtils.isEmpty(bodyValue)) bodyValue = extras.getCharSequence(Notification.EXTRA_TEXT);
            String title = titleValue == null ? "" : titleValue.toString().trim();
            String body = bodyValue == null ? "" : bodyValue.toString().trim();
            if (title.isEmpty() && body.isEmpty()) return;
            String stableId = sha256(packageName + "|" + sbn.getKey());
            JSONArray queue = new JSONArray(prefs.getString("queue", "[]"));
            for (int i = 0; i < queue.length(); i++) if (stableId.equals(queue.getJSONObject(i).optString("id"))) return;
            queue.put(new JSONObject().put("id", stableId).put("packageName", packageName).put("title", title).put("body", body).put("postedAt", sbn.getPostTime()));
            while (queue.length() > 50) queue.remove(0);
            prefs.edit().putString("queue", queue.toString()).putLong("lastCapturedAt", sbn.getPostTime()).apply();
            NotificationCapturePlugin.notifyCaptureAvailable();
        } catch (Exception ignored) { /* Notification contents are intentionally never logged. */ }
    }
    private String sha256(String value) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder(); for (byte b : bytes) result.append(String.format("%02x", b)); return result.toString();
    }
}
