const path = require('path');
const Dotenv = require('dotenv-webpack');
const webpack = require('webpack');

/*
 * The service worker will cache all HTML/CSS/JS when it is installed and will
 * only refresh when the service worker file changes.  So, generate a version
 * based on the date and time the service worker file was built and inject it
 * into the service worker file.
 *
 * This is not necessary during development, since the service worker won't use
 * cached files under the 'localhost' domain.
 */
let VERSION = '';

if (process.env.NODE_ENV === 'production')
  VERSION = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[\-:]/g, '.')
    .replace('T', '_');

module.exports = {
  mode: process.env.NODE_ENV,
  entry: {
    'theme': path.resolve(__dirname, 'src', 'theme.scss'),
    'errors': path.resolve(__dirname, 'src', 'errors.js'),
    'install': path.resolve(__dirname, 'src', 'install.js'),
    'sw': path.resolve(__dirname, 'src', 'sw.js'),
    'ww': path.resolve(__dirname, 'src', 'ww.js'),
    'tactics': path.resolve(__dirname, 'src', 'tactics.js'),
    'check': path.resolve(__dirname, 'src', 'check.js'),

    'faceoff-app': path.resolve(__dirname, 'src', 'faceoff-app.js'),
    'chaos-app': path.resolve(__dirname, 'src', 'chaos-app.js'),
    'classic-app': path.resolve(__dirname, 'src', 'classic-app.js'),
    'game-app': path.resolve(__dirname, 'src', 'game-app.js'),

    'online': path.resolve(__dirname, 'src', 'online.js'),
    'createGame': path.resolve(__dirname, 'src', 'createGame.js'),
    'account': path.resolve(__dirname, 'src', 'account.js'),
    'addDevice': path.resolve(__dirname, 'src', 'addDevice.js'),
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', {
                targets: {
                  edge: 15,
                },
                useBuiltIns: 'usage',
                corejs: 3,
              }],
            ],
          }
        }
      },
      {
        test: /\.css$/,
        use: [
          { loader: 'style-loader' },
          { loader: 'css-loader', options: { url: false } }
        ]
      },
      {
        test: /\.scss$/,
        use: [
          { loader: 'style-loader' },
          { loader: 'css-loader', options: { url: false } },
          { loader: 'sass-loader' }
        ]
      }
    ]
  },
  output: {
    path: path.resolve(__dirname, process.env.NODE_ENV === 'production' ? 'dist' : 'static'),
    filename: chunkData => chunkData.chunk.name === 'sw' ? '[name].js': '[name].min.js',
  },
  optimization: {
    minimize: true
  },
  resolve: {
    alias: {
      config: path.resolve(__dirname, 'config'),
      server: path.resolve(__dirname, 'src', 'server'),
      client: path.resolve(__dirname, 'src', 'client'),
      models: path.resolve(__dirname, 'src', 'models'),
      components: path.resolve(__dirname, 'src', 'components'),
      tactics: path.resolve(__dirname, 'src', 'tactics'),
      utils: path.resolve(__dirname, 'src', 'utils'),
      plugins: path.resolve(__dirname, 'src', 'plugins'),
    }
  },
  plugins: [
    new Dotenv(),
    new webpack.DefinePlugin({ 'VERSION':JSON.stringify(VERSION) }),
  ],
  devtool: process.env.NODE_ENV === 'production' ? false : 'eval-source-map',
  performance: { hints: false },
};
