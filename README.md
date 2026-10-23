# Basement Launcher

A custom Android TV / Google TV home screen: a full-screen WebView showing a 3D model of the room the TV is in, with a D-pad app dock on top. Kotlin handles listing and launching apps; everything visible is HTML/JS in `app/src/main/assets`.

## Room scan
The scan isn't in this repo. Export your own room from Polycam (Room / RoomPlan mode) as GLB and save it as `app/src/main/assets/room.glb`.

## Build
Requires JDK 21, Android SDK (platform 34, build-tools 34), Gradle 8.7, and adb connected to the TV.

    ./build.sh
