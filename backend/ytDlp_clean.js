const { spawn } = require('child_process');

const args = [
    '-f', '18',
    '--newline',
    '--progress',
    '--progress-template',
    '%(progress)j',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    '-o', 'scratch_temp_video2.mp4'
];

console.log('Spawning yt-dlp with %(progress)j...');
const child = spawn('yt-dlp', args, { windowsHide: true });

child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
        console.log('STDOUT:', line);
    }
});

child.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
        console.log('STDERR:', line);
    }
});

child.on('close', (code) => {
    console.log('Exited with code:', code);
});