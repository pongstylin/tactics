# Tactics

Tactics is a JavaScript turn-based strategy board game using HTML5 and WebGL.  It has full touch support and can be added to the home screen of your mobile device for a near native app experience.

This project is derivative of the flash-based Tactics Arena Online (TAO) game that has since been shut down.  It makes use of image and audio files from that game to expedite development.  All attempts to contact the rights-holder of these resources have been unsuccessful, so a legal right to use them should not be assumed.

## Requirements
* Node.js

## Development
After checking out the Git repository, run these commands.

```bash
$ npm install
$ npm run watch
$ npm start
```

The start command will output a URL that can be used to run the game.

After making changes, the watch command must be run again to have it reflected on the development URL.

## Contributing
Pull requests are encouraged. For major changes, please open an issue first to discuss what you would like to change.

If you are familiar with Tactics Arena Online and/or would like to assist in porting the animations of other units from that game to this one, please contact us.

## Distribution

The `dist` directory contains JavaScript bundles that can be used to publish the game to a website.  In additional to these, the jQuery library is required.  The HTML files in the `static` directory can serve as an example of how to publish the game to a website.

After making changes to the source, the distribution bundles can be rebuilt using this command:

```bash
$ npm run dist
```

Be aware that no license currently exists for distributing this game as-is for public use since rights have not been acquired for the image and audio files used by it.  You may, however, make use of such resources when contributing additional work to this repository.  You may also create your own image and audio files and integrate them with this source code and publish the work for public use.

## License
All contents under the `src` directory fall under the following license:
[Unlicense](https://choosealicense.com/licenses/unlicense/)

All contents under the `lib` directory are licensed according to their respective licenses.

All image and audio files that are loaded from the http://www.taorankings.com domain are not licensed ([No License](https://choosealicense.com/no-permission/)).
