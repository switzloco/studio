# Google Health API Setup Guide

To finish the migration to the new Google Health API, you need to create OAuth credentials in the Google Cloud Console. 

Follow these steps precisely:

## 1. Configure the OAuth Consent Screen
1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and select your project (`studio-4236902803-1eba2`).
2. In the left sidebar, navigate to **APIs & Services > OAuth consent screen**.
3. Select **External** and click **Create**.
4. Fill out the app information:
   - **App name**: The CFO (or your preferred app name)
   - **User support email**: Your email
   - **Developer contact information**: Your email
5. Click **Save and Continue**.
6. On the **Scopes** step, click **Add or Remove Scopes**.
7. Scroll down to manually paste/add the following custom scopes (since they might not be in the default list until you add them):
   - `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`
   - `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`
   - `https://www.googleapis.com/auth/googlehealth.sleep.readonly`
   - `https://www.googleapis.com/auth/googlehealth.profile.readonly`
8. Click **Update**, then **Save and Continue**.
9. Add yourself as a **Test User** (add your Google Account email) so you can test the login before submitting the app for verification.
10. Click **Save and Continue**, then back to Dashboard.

## 2. Create the OAuth Client ID
1. Navigate to **APIs & Services > Credentials**.
2. Click **+ Create Credentials** at the top, and select **OAuth client ID**.
3. Under **Application type**, select **Web application**.
4. Give it a name (e.g., "Web Client 1").
5. Under **Authorized JavaScript origins**, click **+ Add URI** and add:
   - `http://localhost:9002`
   - `https://studio--studio-4236902803-1eba2.us-central1.hosted.app`
6. Under **Authorized redirect URIs**, click **+ Add URI** and add exactly these two URIs:
   - `http://localhost:9002/api/auth/fitbit/callback`
   - `https://studio--studio-4236902803-1eba2.us-central1.hosted.app/api/auth/fitbit/callback`
7. Click **Create**.

## 3. Update Your Environment Variables
A modal will appear with your new **Client ID** and **Client Secret**. 

Copy those and paste them into your `.env.local` file (I have already added the blank placeholders for you):
```env
NEXT_PUBLIC_GOOGLE_HEALTH_CLIENT_ID=your-client-id
GOOGLE_HEALTH_CLIENT_SECRET=your-client-secret
```

Make sure to also add these as secrets/environment variables in your Firebase App Hosting deployment so the production app can access them.

## 4. Why App Verification?
Because the Google Health API scopes are considered "Restricted", Google will eventually require you to verify your app if you want to allow *any* user to log in. 
While in "Testing" mode, only the emails you manually added to the "Test Users" list will be able to connect their Fitbit data. This is perfect for now while you build and test.
