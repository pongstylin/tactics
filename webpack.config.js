const path = require('path');

module.exports = (env, argv) => ({
  entry: {
    tactics: path.resolve(__dirname, 'src/tactics.js'),
    'faceoff-app': path.resolve(__dirname, 'src/faceoff-app.js'),
    'chaos-app': path.resolve(__dirname, 'src/chaos-app.js'),
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
    path: path.resolve(__dirname, argv.mode === 'production' ? 'dist' : 'static'),
    filename: '[name].min.js'
  },
  optimization: {
    minimize: true
  },
  resolve: {
    alias: {
      tactics: path.resolve(__dirname, 'src/tactics'),
      util: path.resolve(__dirname, 'src/util'),
      lib: path.resolve(__dirname, 'lib'),
    }
  },
  devtool: argv.mode === 'production' ? false : 'eval-source-map',
});
