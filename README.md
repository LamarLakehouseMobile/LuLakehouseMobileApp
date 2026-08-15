# Lakehouse Mobile App

This project is a React Native Expo mobile application for a Lakehouse-style learning and training workflow. The app supports user authentication, model training workflows, image capture, audio capture, and teaching a custom ML model using a browser-based or WebView-based ML engine.

## Overview

The app is structured around a few core ideas:

- Users sign in or register with Supabase Auth.
- Once authenticated, they navigate through the app using a native stack navigator.
- The home dashboard gives access to a Teachable Machine training flow.
- Image and audio training screens capture samples, send them to the ML engine, and train a model.
- The app uses context providers to share auth and ML state across screens.

## Tech Stack

- React Native
- Expo
- TypeScript
- @react-navigation/native
- @supabase/supabase-js
- AsyncStorage
- Expo Camera and Audio libraries
- WebView-based ML engine integration

## Project Structure

- `App.tsx` – app bootstrap and root providers
- `index.ts` – entry point for the Expo app
- `app.json` – Expo configuration and app metadata
- `components/` – reusable UI components such as buttons, navbars, inputs, and capture modal
- `context/` – app-wide state providers including auth and ML
- `hooks/` – wrappers around auth and ML hooks
- `lib/supabase.ts` – Supabase client setup
- `ml/` – ML engine logic and sample storage helpers
- `navigation/` – stack and navigator configuration
- `screens/` – all app screens
- `types/` – custom typings
- `.env` – environment values for Supabase

## Step-by-Step App Flow

### 1. App startup

When the app launches, `App.tsx` creates the provider hierarchy:

- `AuthProvider`
- `MLProvider`
- `NavigationContainer`

This ensures auth state and ML state are available across the application.

### 2. Authentication gate

The app checks whether a user is authenticated through the auth context.

- If there is no valid user, the app shows the authentication flow.
- If a user is present, the app opens the home navigation stack.

The login and registration flow is handled through Supabase Auth, and session persistence is enabled with AsyncStorage.

### 3. Registration and login

The user can:

- register with email and password
- receive a confirmation email if email confirmation is enabled
- sign in after email verification

Auth logic is centralized in `context/AuthContext.ts`.

### 4. Home dashboard

Once signed in, the user sees the home screen and can access app features by using the side navigation menu.

The main navigation items include:

- Home
- Profile
- TeachableMachine
- other training-related screens

### 5. Teachable Machine flow

The app allows users to create ML models based on examples they collect.

The flow usually works like this:

1. User selects a project type or training mode.
2. User captures image or audio examples.
3. The samples are saved locally in app storage.
4. The ML engine is initialized and loaded.
5. Samples are sent to the engine.
6. The model is trained.
7. The user can run prediction/testing against the trained model.

### 6. Image training flow

The image training screen manages the process of gathering image samples for a given class.

Typical steps:

- open capture modal
- take pictures with the device camera
- organize them into classes
- store them locally
- send them to the ML engine
- train the model
- validate predictions

The image capture UI is embedded in the capture modal and connected to the training screen via callback props.

### 7. Audio training flow

The audio flow follows a similar pattern to image training, but records sound samples instead of photos. The app captures microphone input and stores sample recordings before sending them into the ML pipeline.

### 8. ML engine integration

The ML logic resides in the `ml/` folder, especially in files like:

- `engine.ts`
- `capture.ts`
- `storage.ts`

The engine handles:

- loading the model runtime
- receiving training samples
- running training
- making predictions
- managing sample data and state transitions

### 9. Profile and account states

The app exposes account information through the profile view, and session state is managed through the auth context. Email-based account recovery is handled through Supabase auth, which is the secure flow for managed password reset requests.

## Supabase Setup

The app requires a Supabase project with the following values in a local `.env` file:

```bash
EXPO_PUBLIC_SUPABASE_URL=your-project-url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

The client is created in `lib/supabase.ts` and is used for:

- sign in
- sign up
- sign out
- session persistence
- password reset requests

## Security Notes

This app uses Supabase Auth for handle user identity. In front-end code, only public values, such as the project URL and anonymous key, should be stored. Private admin keys must never be exposed in the client app. Sensitive operations should be handled via backend or Supabase-managed auth flows.

## Typical Development Workflow

1. Create or configure the Supabase project.
2. Add the env values in `.env`.
3. Install dependencies with `npm install`.
4. Start Expo with `npx expo start`.
5. Run on Android with `npx expo run:android`.
6. Sign up or log in.
7. Navigate through the training screens.
8. Capture and store samples.
9. Train the model and test predictions.

## Future Enhancements

Possible future improvements include:

- database persistence for user metadata and training projects
- real model storage and export
- cloud-based dataset management
- user dashboards with saved models and training history
- stronger auth and account controls

## Summary

This app combines a mobile training interface with a structured auth system and a machine-learning engine. The user experience is centered on sign in, sample collection, model training, and real-time prediction, all while keeping the app state and auth state centralized via context providers and Supabase.
