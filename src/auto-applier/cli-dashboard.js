import readline from 'readline';

function colorize(text, color, options = {}) {
    if (!process.stdout.isTTY) {
        return text;
    }

    const codes = {
        reset: '\x1b[0m',
        bright: '\x1b[1m',
        dim: '\x1b[2m',
        strikethrough: '\x1b[9m',
        red: '\x1b[31m',
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        blue: '\x1b[34m',
        magenta: '\x1b[35m',
        cyan: '\x1b[36m',
        white: '\x1b[37m',
    };

    const prefix = [
        options.bright ? codes.bright : '',
        options.dim ? codes.dim : '',
        options.strikethrough ? codes.strikethrough : '',
        color ? codes[color] : '',
    ].join('');
    return `${prefix}${text}${codes.reset}`;
}

function getStatusLabel(session) {
    const ui = session?.ui || {};
    if (ui.killed) {
        return colorize('KILLED', 'white', { dim: true, strikethrough: true });
    }
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
        case 'paused':
            return colorize('PAUSED', 'magenta');
        case 'killed':
            return colorize('KILLED', 'white', { dim: true, strikethrough: true });
        default:
            return colorize('STARTING', 'dim');
    }
}

function getSummary(session) {
    return session?.ui?.summary || 'waiting for first update';
}

function truncateText(text, maxLength = 30) {
    if (!text || text.length <= maxLength) {
        return text || '';
    }
    return `${text.slice(0, maxLength - 1)}…`;
}

function promptForInstruction(session, render) {
    if (!session || !process.stdout.isTTY) {
        return;
    }

    const promptText = session.ui?.pendingInstruction
        ? 'Update instruction (blank to resume): '
        : 'Operator instruction (optional, press Enter to resume): ';

    process.stdout.write('\x1b[?25h');
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(promptText, (answer) => {
        rl.close();
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }
        process.stdout.write('\x1b[?25l');

        const instruction = (answer || '').trim();
        if (instruction) {
            session.ui.pendingInstruction = instruction;
            session.ui.events = [
                ...(session.ui.events || []),
                { timestamp: new Date().toISOString(), message: `operator instruction: ${instruction}` },
            ].slice(-20);
        }

        session.ui.attention = false;
        session.ui.status = 'working';
        session.ui.summary = instruction ? `resumed with: ${instruction}` : 'resumed by operator';
        render();
    });
}

function promptForDevSignal(session, render) {
    if (!session || !process.stdout.isTTY) {
        return;
    }

    process.stdout.write('\x1b[?25h');
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Dev signal (blank to cancel): ', (answer) => {
        rl.close();
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }
        process.stdout.write('\x1b[?25l');

        const signal = (answer || '').trim();
        if (!signal) {
            render();
            return;
        }

        session.ui.events = [
            ...(session.ui.events || []),
            { timestamp: new Date().toISOString(), message: `dev signal: ${signal}` },
        ].slice(-20);

        session.ui.summary = `dev signal: ${signal}`;
        if (/manual\s*help|help|assist/i.test(signal)) {
            session.ui.attention = true;
            session.ui.status = 'waiting';
            session.ui.summary = 'manual help requested by dev signal';
            session.ui.events = [
                ...(session.ui.events || []),
                { timestamp: new Date().toISOString(), message: 'manual help flagged by dev signal' },
            ].slice(-20);
        }

        render();
    });
}

function promptForResolve(session, render) {
    if (!session || !process.stdout.isTTY) {
        return;
    }

    process.stdout.write('\x1b[?25h');
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Resolution label (blank to mark resolved): ', (answer) => {
        rl.close();
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }
        process.stdout.write('\x1b[?25l');

        const label = (answer || '').trim();
        session.ui.attention = false;
        session.ui.pendingInstruction = null;
        session.ui.status = 'done';
        session.ui.resolved = true;
        session.ui.summary = label || 'resolved by operator';
        session.ui.completedLabel = session.ui.summary;
        session.ui.agentName = label || 'resolved by operator';
        session.ui.events = [
            ...(session.ui.events || []),
            { timestamp: new Date().toISOString(), message: `resolved by operator${label ? `: ${label}` : ''}` },
        ].slice(-20);
        render();
    });
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
            console.log(colorize('Backspace: back • Enter: go • p: pause/unpause • h: manual help • d: dev signal • r: resolve • q: quit', 'dim'));
        } else {
            console.log(colorize('w/s: move • Enter: go • r: resolve • q: quit', 'dim'));
        }
        console.log('');

        if (!sessions.length) {
            console.log('No tabs created yet...');
            return;
        }

        if (detailView && sessions[selectedIndex]) {
            const session = sessions[selectedIndex];
            console.log(colorize(`Tab: ${session.label}`, 'cyan', { bright: true }));
            console.log(colorize(`URL: ${truncateText(session.url)}`, 'white'));
            console.log(colorize(`Status: ${session.ui?.status || 'idle'}`, 'white'));
            console.log(colorize(`Summary: ${getSummary(session)}`, 'white'));
            console.log(colorize(`Resolved: ${session.ui?.resolved ? 'yes' : 'no'}`, 'white'));
            console.log(colorize(`Agent name: ${session.ui?.agentName || 'none'}`, 'white'));
            console.log(colorize(`Completed label: ${session.ui?.completedLabel || 'none'}`, 'white'));
            console.log(colorize(`Vision thought: ${session.ui?.visionThought || 'none'}`, 'white'));
            console.log(colorize(`Nav thought: ${session.ui?.navThought || 'none'}`, 'white'));
            console.log(colorize(`Current thought: ${session.ui?.currentThought || 'none'}`, 'white'));
            console.log(colorize(`Pending instruction: ${session.ui?.pendingInstruction || 'none'}`, 'white'));
            console.log(colorize(`Killed: ${session.ui?.killed ? 'yes' : 'no'}`, 'white'));
            console.log('');
            console.log(colorize('Recent actions:', 'yellow'));
            const events = session.ui?.events || [];
            if (!events.length) {
                console.log('No actions recorded yet.');
            } else {
                events.slice(-15).reverse().forEach((event) => {
                    const when = new Date(event.timestamp).toLocaleTimeString();
                    console.log(`- [${when}] ${event.message}`);
                });
            }
            console.log('');
            console.log(colorize('Press Backspace to go back to the tab list', 'dim'));
            return;
        }

        sessions.forEach((session, index) => {
            const isSelected = index === selectedIndex;
            const prefix = isSelected ? '>' : ' ';
            const label = `${prefix} ${session.label}`;
            const line = `${label}  ${getStatusLabel(session)}  ${getSummary(session)}  ${session.url ? `(url: ${truncateText(session.url)})` : ''}`;
            let visual;
            if (session.ui?.killed) {
                visual = colorize(line, 'white', { dim: true, strikethrough: true });
            } else if (isSelected) {
                visual = colorize(line, 'cyan', { bright: true });
            } else if (session.ui?.attention) {
                visual = colorize(line, 'red');
            } else {
                visual = line;
            }
            console.log(visual);
        });
    }

    function handleKeypress(str, key) {
        if (!key) {
            return;
        }

        if (detailView) {
            if (key.name === 'backspace' || key.name === 'escape') {
                detailView = false;
                render();
                return;
            }

            if (key.name === 'w') {
                selectedIndex = Math.max(0, selectedIndex - 1);
                render();
                return;
            }

            if (key.name === 's') {
                const sessions = getSessions?.() || [];
                selectedIndex = Math.min(Math.max(0, sessions.length - 1), selectedIndex + 1);
                render();
                return;
            }

            if (key.name === 'return') {
                const sessions = getSessions?.() || [];
                const session = sessions[selectedIndex];
                promptForInstruction(session, render);
                return;
            }

            if (key.name === 'p') {
                const sessions = getSessions?.() || [];
                const session = sessions[selectedIndex];
                if (session?.ui) {
                    session.ui.paused = !session.ui.paused;
                    session.ui.status = session.ui.paused ? 'paused' : 'working';
                    session.ui.summary = session.ui.paused ? 'paused by operator' : 'resumed from pause';
                    session.ui.events = [
                        ...(session.ui.events || []),
                        { timestamp: new Date().toISOString(), message: session.ui.paused ? 'paused by operator' : 'resumed from pause' },
                    ].slice(-20);
                }
                render();
                return;
            }

            if (key.name === 'h') {
                const sessions = getSessions?.() || [];
                const session = sessions[selectedIndex];
                if (session?.ui) {
                    session.ui.attention = true;
                    session.ui.status = 'waiting';
                    session.ui.summary = 'manual help requested by dev';
                    session.ui.events = [
                        ...(session.ui.events || []),
                        { timestamp: new Date().toISOString(), message: 'manual help flagged by developer' },
                    ].slice(-20);
                }
                render();
                return;
            }

            if (key.name === 'd') {
                const sessions = getSessions?.() || [];
                const session = sessions[selectedIndex];
                promptForDevSignal(session, render);
                return;
            }

            if (key.name === 'k') {
                const sessions = getSessions?.() || [];
                const session = sessions[selectedIndex];
                if (session?.ui) {
                    session.ui.killed = true;
                    session.ui.paused = false;
                    session.ui.attention = false;
                    session.ui.status = 'killed';
                    session.ui.summary = 'killed by operator';
                    session.ui.events = [
                        ...(session.ui.events || []),
                        { timestamp: new Date().toISOString(), message: 'killed by operator' },
                    ].slice(-20);
                }
                render();
                return;
            }

            if (key.name === 'r') {
                const sessions = getSessions?.() || [];
                const session = sessions[selectedIndex];
                promptForResolve(session, render);
                return;
            }

            return;
        }

        if (key.name === 'w' || key.name === 'up') {
            selectedIndex = Math.max(0, selectedIndex - 1);
            render();
            return;
        }

        if (key.name === 's' || key.name === 'down') {
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

        if (key.name === 'r') {
            const sessions = getSessions?.() || [];
            const session = sessions[selectedIndex];
            promptForResolve(session, render);
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
