process.stdout.write('dsh web: http://127.0.0.1:43123\n')
setTimeout(() => {
  process.stdout.write('dsh web: http://127.0.0.1:43124\nprivate-after-ready\n')
}, 20)
setInterval(() => {}, 1_000)
