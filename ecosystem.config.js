module.exports = {
    apps: [
      {
        name: 'express-app',
        script: 'index.js',
        watch: false,
        env: {
          NODE_ENV: 'production'
        }
      }
    ]
  }
  