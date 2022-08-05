# Tactics

[Play Online](https://tactics.taorankings.com/)

Tactics is a JavaScript turn-based strategy board game using HTML5 and WebGL.  It has full touch support and can be added to the home screen of your mobile device for a near native app experience.

This project is derivative of the flash-based Tactics Arena Online (TAO) game that has since been shut down.  It makes use of image and audio files from that game to expedite development.  All attempts to contact the rights-holder of these resources have been unsuccessful, so a legal right to use them should not be assumed.

## Goals

When the original game was abandoned, it was missed by a large community of players that still exists today.  Because of that nostalgia, this project attempts to recapture the authentic game-playing experience of the original.  That means using the original graphics and sound effects as long as it is legally possible.  On that note, if legally challenged, an attempt will be made to acquire a license to use these materials.  Also, the intent is to recreate all of the units from the original game with their original stats and behavior.

It is not enough to recreate the original game experience.  It is important to make sure it can never die again.  That is why this is an open source project that is in the Public Domain.  Anyone may choose to host this game on their own servers for public use.  You are also encouraged to rebrand and reskin your version of the game.  Be creative, change up the units, stats, and behavior to create something new.  This project will make sure that the original experience remains preserved.

The final goal of this project is to keep the game relevant as technology changes.  The original game used Flash and did not transition well to the mobile lifestyle.  So this project uses HTML5 web technology that can be used on any system whether you're using a mouse, your finger, or a stylus.  To meet this goal, this game will differ in minor ways from the original, but not in ways that anybody would complain about.

That is as far as it goes.  This project is intended to recreate the core game experience in the modern world.  It will not include community support features such as clans, private messaging, or tournament hosting.  Anybody who hosts this game is responsible for building such features according to their personal preference.

## Requirements
* Node.js tested on version v16.16.0

To install under windows, you also need Git Bash and configure npm to use the Git Bash executable.
Example:
```bash
npm config set script-shell "C:\\Program Files\\Git\\bin\\bash.exe"
```

## Development
After checking out the Git repository, run these commands.

```bash
$ npm install
$ npm start
```

The start command will output a URL that can be used to run the game and build JavaScript bundles for use by that URL.  The command will continue to monitor source files and rebuild the bundles as changes are made.

You may locally host image and audio resources.  For example, download and unzip the sprite JSON files from [here](https://tactics.taorankings.com/sprites.zip) to the "/static/sprites" directory.  Then set the "SPRITE\_SOURCE" in the ".env" file to "/sprites/".  Not all image and audio resources are currently included in the zip, but the few exceptions will eventually be incorporated.

## Contributing
Pull requests are encouraged. For major changes, please open an issue first to discuss what you would like to change.

## Distribution

The HTML files in the `static` directory can serve as an example of how to publish the game to a website.  They make use of distribution JS bundles built using this command:

```bash
$ npm run dist
```

Be aware that no license currently exists for distributing this game as-is for public use since rights have not been acquired for the image and audio resources used by it.  It is probably safe to use them, however, during development of this project or a fork of it.  You are also encouraged to create your own image and audio resources and integrate them with this source code and publish the work for public use.

## License
All content under the `src` directory fall under the following license:
[Unlicense](https://choosealicense.com/licenses/unlicense/)

No license is available for audio and iamges resources contained in JSON files downloaded from the tactics.taorankings.com site ([No License](https://choosealicense.com/no-permission/)).

## Credits
[<img src="https://user-images.githubusercontent.com/8408196/68429603-675de280-017c-11ea-9dba-a736d34dace3.png" alt="Browser Stack Logo" width="200">](https://www.browserstack.com/)

[BrowserStack](http://www.browserstack.com) is kind enough to offer a free service to open source projects such as this.  Their service is used to test the game across a wide range of devices and browsers.
