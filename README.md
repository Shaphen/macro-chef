# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Apple Health / dev build

Everything except Apple Health runs in **Expo Go** (`npx expo start`). HealthKit is a native
module Expo Go can't load, so the Activity screen reports "needs the development build" there —
the rest of the app is unaffected.

To use Apple Health, build and install the dev client once (needs an Apple Developer account;
run it again only when native config changes, not for JS changes):

```bash
eas build --profile development --platform ios   # ~15-20 min, then install on the iPhone
npx expo start --dev-client                      # daily loop from then on
```

`eas-cli` is installed globally (`npm install -g eas-cli` if it ever goes missing) — **`npx eas`
does not work**, the npm package is named `eas-cli` while its binary is `eas`, so npx fails with
"could not determine executable to run".

On first launch open **Activity** (Dashboard → ACTIVITY card, or Settings → Apple Health) and tap
**Connect Apple Health**, then allow the categories in the permission sheet. MacroChef requests
**read-only** access to weight, steps, active + resting energy, exercise minutes, sleep and
workouts; it never writes to Health.

If a sync reports that Health returned nothing, the reads were denied — iOS hides read denials
from apps. Fix in **Health app → Sharing → Apps → MacroChef**.

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
