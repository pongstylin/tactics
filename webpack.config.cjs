const package = require('./package.json');
const path = require('path');
const Dotenv = require('dotenv-webpack');
const webpack = require('webpack');
const TerserPlugin = require("terser-webpack-plugin");

module.exports = {
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
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
    'profile': path.resolve(__dirname, 'src', 'profile.js'),
    'security': path.resolve(__dirname, 'src', 'security.js'),
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
                corejs: 3.14,
              }],
            ],
          }
        }
      },
      {
        test: /\.css$/,
        use: [
          { loader:'style-loader' },
          { loader:'css-loader', options:{ url:false } }
        ]
      },
      {
        test: /\.scss$/,
        use: [
          { loader:'style-loader' },
          { loader:'css-loader', options:{ url:false } },
          { loader:'sass-loader' }
        ]
      }
    ]
  },
  output: {
    path: path.resolve(__dirname, process.env.NODE_ENV === 'production' ? 'dist' : 'static'),
    filename: chunkData => chunkData.chunk.name === 'sw' ? '[name].js': '[name].min.js',
  },
  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin({
      extractComments: false,
    })]
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
    new webpack.DefinePlugin({
      'VERSION': JSON.stringify(package.version),
      'ENVIRONMENT': JSON.stringify(process.env.NODE_ENV),
    }),
  ],
  devtool: process.env.NODE_ENV === 'production' ? false : 'eval-source-map',
  performance: { hints: false },
};
