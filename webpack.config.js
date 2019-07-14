const path = require('path');
const Dotenv = require('dotenv-webpack');

module.exports = {
  mode: process.env.NODE_ENV,
  entry: {
    tactics: path.resolve(__dirname, 'src', 'tactics.js'),
    'faceoff-app': path.resolve(__dirname, 'src', 'faceoff-app.js'),
    'chaos-app': path.resolve(__dirname, 'src', 'chaos-app.js'),
    'classic-app': path.resolve(__dirname, 'src', 'classic-app.js'),
    'game-app': path.resolve(__dirname, 'src', 'game-app.js'),
    'ww': path.resolve(__dirname, 'src', 'ww.js'),
    'online': path.resolve(__dirname, 'src', 'online.js'),
    'createGame': path.resolve(__dirname, 'src', 'createGame.js'),
  },
  module: {
    rules: [
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
    filename: '[name].min.js'
  },
  optimization: {
    minimize: true
  },
  resolve: {
    alias: {
      config: path.resolve(__dirname, 'config'),
      client: path.resolve(__dirname, 'src', 'client'),
      models: path.resolve(__dirname, 'src', 'models'),
      tactics: path.resolve(__dirname, 'src', 'tactics'),
      utils: path.resolve(__dirname, 'src', 'utils'),
      plugins: path.resolve(__dirname, 'src', 'plugins'),
    }
  },
  plugins: [
    new Dotenv(),
  ],
  devtool: process.env.NODE_ENV === 'production' ? false : 'eval-source-map',
  performance: { hints: false },
};
