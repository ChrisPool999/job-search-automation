import readline from 'readline';

function colorize(text, color, options = {}) {
    if (!process.stdout.isTTY) {
        return text;
    }

    const codes = {
        reset: '\x1b[0m',
        bright: '\x1b[1m',
        dim: '\x1b[2m',
        red: '\x1b[31m',
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        blue: '\x1b[34m',
        magenta: '\x1b[35m',
        cyan: '\x1b[36m',
        white: '\x1b[37m',
    };

    const prefix = [options.bright ? codes.bright : '', color ? codes[color] : ''].join('');
    return `${prefix}${text}${codes.reset}`;
}

function getStatusLabel(session) {
    const ui = session?.ui || {};
    if (ui.attention) {
        return colorize('NEEDS ATTENTION', 'red', { bright: true });
    }

    switch (ui.status) {
        case 'done':
            return colorize('DONE', 'green');
        case 'navigating':
            return colorize('NAVIGATING', 'cyan');
        case 'working':
            return colorize('RUNNING', 'blue');
        case 'waiting':
            return colorize('WAITING', 'yellow');
        default:
            return colorize('STARTING', 'dim');
    }
}

function getSummary(session) {
    return session?.ui?.summary || 'waiting for first update';
}

export function createCliDashboard({ getSessions } = {}) {
    let active = false;
    let selectedIndex = 0;
    let detailView = false;
    let renderInterval = null;
    let keypressHandler = null;

    function render() {
        const sessions = getSessions?.() || [];
        if (!process.stdout.isTTY || !active) {
            return;
        }

        process.stdout.write('\x1b[2J\x1b[H');
        process.stdout.write('\x1b[?25l');
        console.log(colorize('Automation Tab Dashboard', 'cyan', { bright: true }));
        if (detailView) {
            console.log(colorize('j: go back • k: move up • p: ping • q: quit', 'dim'));
        } else {
            console.log(colorize('j/k: move • Enter: inspect • p: ping • q: quit', 'dim'));
        }
        console.log('');

        if (!sessions.length) {
            console.log('No tabs created yet...');
            return;
        }

        if (detailView && sessions[selectedIndex]) {
            const session = sessions[selectedIndex];
            console.log(colorize(`Tab: ${session.label}`, 'cyan', { bright: true }));
            console.log(colorize(`Status: ${session.ui?.status || 'idle'}`, 'white'));
            console.log(colorize(`Summary: ${getSummary(session)}`, 'white'));
            console.log('');
            console.log(colorize('Recent events:', 'yellow'));
            const events = session.ui?.events || [];
            if (!events.length) {
                console.log('No events recorded yet.');
            } else {
                events.slice(-10).reverse().forEach((event) => {
                    const when = new Date(event.timestamp).toLocaleTimeString();
                    console.log(`- [${when}] ${event.message}`);
                });
            }
            console.log('');
            console.log(colorize('Press j to go back to the tab list', 'dim'));
            return;
        }

        sessions.forEach((session, index) => {
            const isSelected = index === selectedIndex;
            const prefix = isSelected ? '>' : ' ';
            const label = `${prefix} ${session.label}`;
            const line = `${label}  ${getStatusLabel(session)}  ${getSummary(session)}`;
            const visual = isSelected
                ? colorize(line, 'cyan', { bright: true })
                : session.ui?.attention
                    ? colorize(line, 'red')
                    : line;
            console.log(visual);
        });
    }

    function handleKeypress(str, key) {
        if (!key) {
            return;
        }

        if (detailView) {
            if (key.name === 'j' || key.name === 'escape' || key.name === 'backspace') {
                detailView = false;
                render();
                return;
            }

            if (key.name === 'k') {
                selectedIndex = Math.max(0, selectedIndex - 1);
                render();
                return;
            }

            if (key.name === 'p') {
                const sessions = getSessions?.() || [];
                const session = sessions[selectedIndex];
                if (session?.ui) {
                    session.ui.attention = true;
                    session.ui.summary = 'Pinged — needs attention';
                    session.ui.events = [
                        ...(session.ui.events || []),
                        { timestamp: new Date().toISOString(), message: 'Pinged by operator' },
                    ].slice(-20);
                }
                render();
                return;
            }

            return;
        }

        if (key.name === 'up' || key.name === 'k') {
            selectedIndex = Math.max(0, selectedIndex - 1);
            render();
            return;
        }

        if (key.name === 'down' || key.name === 'j') {
            const sessions = getSessions?.() || [];
            selectedIndex = Math.min(Math.max(0, sessions.length - 1), selectedIndex + 1);
            render();
            return;
        }

        if (key.name === 'return') {
            detailView = true;
            render();
            return;
        }

        if (key.name === 'p') {
            const sessions = getSessions?.() || [];
            const session = sessions[selectedIndex];
            if (session?.ui) {
                session.ui.attention = true;
                session.ui.summary = 'Pinged — needs attention';
                session.ui.events = [
                    ...(session.ui.events || []),
                    { timestamp: new Date().toISOString(), message: 'Pinged by operator' },
                ].slice(-20);
            }
            render();
            return;
        }

        if (key.name === 'q' || key.ctrl && key.name === 'c') {
            stop();
            process.exit(0);
        }
    }

    function start() {
        if (!process.stdout.isTTY || active) {
            return;
        }

        active = true;
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }
        readline.emitKeypressEvents(process.stdin);
        keypressHandler = (str, key) => handleKeypress(str, key);
        process.stdin.on('keypress', keypressHandler);
        renderInterval = setInterval(() => render(), 600);
        render();
    }

    function stop() {
        active = false;
        if (renderInterval) {
            clearInterval(renderInterval);
        }
        if (keypressHandler) {
            process.stdin.removeListener('keypress', keypressHandler);
        }
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
        process.stdout.write('\x1b[?25h');
        process.stdout.write('\x1b[0m');
    }

    return { start, stop, render };
}
