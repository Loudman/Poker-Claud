const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  mode: 'development',
  entry: './src/renderer/index.ts',
  target: 'electron-renderer',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader', 'postcss-loader']
      },
      {
        test: /\.(png|jpg|jpeg|gif|webp|svg)$/i,
        type: 'asset/resource',
        generator: { filename: 'assets/[name][ext]' }
      },
      {
        test: /\.(ogg|mp3|wav|flac)$/i,
        type: 'asset/resource',
        generator: { filename: 'assets/audio/[name][ext]' }
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js', '.css']
  },
  output: {
    filename: 'renderer.js',
    path: path.resolve(__dirname, 'dist/renderer')
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/renderer/index.html',
      filename: 'index.html'
    })
  ]
};
