const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    entry: './src/index.tsx',

    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'main.js',
      clean: true,
      publicPath: '/',
    },

    // Deterministic builds: identical source -> identical output.
    // See scripts/webui-build.sh for the full reproducibility contract.
    optimization: {
      moduleIds: 'deterministic',
      chunkIds: 'deterministic',
      minimizer: [
        '...',
        new CssMinimizerPlugin(),
      ],
    },

    // No filesystem cache. scripts/webui-build.sh also deletes
    // .cache and node_modules/.cache before every run, but
    // cache:false is the primary guarantee.
    cache: false,

    // Separate .map files committed alongside the bundle for
    // browser DevTools debugging without a live dev server.
    devtool: isProduction ? 'source-map' : 'eval-source-map',

    resolve: {
      extensions: ['.tsx', '.ts', '.js'],
    },

    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: [
            isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
            'css-loader',
          ],
        },
      ],
    },

    plugins: [
      new HtmlWebpackPlugin({
        template: './src/index.html',
        filename: 'index.html',
        favicon: './src/icon.svg',
      }),
      ...(isProduction
        ? [
            new MiniCssExtractPlugin({
              filename: 'main.css',
            }),
          ]
        : []),
    ],

    devServer: {
      port: 8080,
      historyApiFallback: true,
      proxy: [
        {
          context: ['/v1', '/connector'],
          target: 'http://127.0.0.1:3000',
        },
      ],
    },
  };
};
