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
    if (ui.blocked) {
        return colorize('BLOCKED', 'magenta', { bright: true });
    }
    if (ui.completedByOperator) {
        return colorize('DONE (OP)', 'green', { bright: true });
    }
    if (ui.attention) {
        return colorize('NEEDS ATTENTION', 'red', { bright: true });
    }

    switch (ui.status) {
        case 'blocked':
            return colorize('BLOCKED', 'magenta');
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

function extractVisionFromThought(thought) {
    if (!thought) return '';
    const idx = thought.indexOf('Nav:');
    if (idx !== -1) {
        return thought.slice(0, idx).replace(/^Vision:\s*/i, '').trim();
    }
    return thought.replace(/^Vision:\s*/i, '').trim();
}

function extractNavFromThought(thought) {
    if (!thought) return '';
    const idx = thought.indexOf('Nav:');
    if (idx !== -1) {
        return thought.slice(idx + 4).trim();
    }
    return '';
}

function getRecentSteps(session, max = 5) {
    const history = session?.history || [];
    const recent = history.slice(-max).reverse();
    return recent.map((h) => {
        const step = h.step ? `${h.step}. ` : '';
        const target = h.targetText || h.description || '';
        const result = h.result ? ` => ${h.result}` : '';
        return `${step}${truncateText(target, 80)}${result}`;
    });
}

function getRecentNavThoughts(session, max = 5) {
    const history = session?.history || [];
    const recent = history.slice(-max).reverse();
    return recent.map((h) => {
        const byNav = h.navAction || extractNavFromThought(h.thought) || '';
        const match = h.navMatched ? ` (match: ${truncateText(h.navMatched, 40)})` : '';
        return byNav ? `${truncateText(byNav, 80)}${match}` : '(none)';
    });
}

function getRecentVisionThoughts(session, max = 5) {
    const history = session?.history || [];
    const recent = history.slice(-max).reverse();
    return recent.map((h) => {
        const v = extractVisionFromThought(h.thought) || session?.ui?.visionThought || '';
        return v ? truncateText(v, 100) : '(none)';
    });
}

let renderSuspended = false;

function promptForInstruction(session, render) {
    if (!session || !process.stdout.isTTY) {
        return;
    }

    renderSuspended = true;
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
        process.stdin.resume();
        process.stdout.write('\x1b[?25l');
        renderSuspended = false;

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


function resolveAttention(session, render) {
    if (!session?.ui || !process.stdout.isTTY) {
        return;
    }

    const canResume = Boolean(session.ui.attention || session.ui.blocked || session.ui.completedByOperator);
    if (!canResume) {
        return;
    }

    session.ui.attention = false;
    session.ui.blocked = false;
    session.ui.completedByOperator = false;
    session.ui.pendingInstruction = null;
    session.ui.paused = false;
    session.ui.status = 'working';
    session.ui.summary = 'resumed by operator';
    session.ui.events = [
        ...(session.ui.events || []),
        { timestamp: new Date().toISOString(), message: 'resumed by operator' },
    ].slice(-20);
    render();
}

export function createCliDashboard({ getSessions } = {}) {
    let active = false;
    let selectedIndex = 0;
    let detailView = false;
    let renderInterval = null;
    let keypressHandler = null;

    function render() {
        const sessions = getSessions?.() || [];
        if (!process.stdout.isTTY || !active || renderSuspended) {
            return;
        }

        process.stdout.write('\x1b[2J\x1b[H');
        process.stdout.write('\x1b[?25l');
        console.log(colorize('Automation Tab Dashboard', 'cyan', { bright: true }));
        if (detailView) {
            console.log(colorize('Backspace: back • Enter: go • r: resume • q: quit', 'dim'));
        } else {
            console.log(colorize('w/s: move • Enter: go • r: resume • q: quit', 'dim'));
        }
        console.log('');

        if (!sessions.length) {
            console.log('No tabs created yet...');
            return;
        }

        if (detailView && sessions[selectedIndex]) {
            const session = sessions[selectedIndex];
            const activeAgent = session.ui?.activeAgent;
            const isNavActive = activeAgent === 'nav';
            const isVisionActive = activeAgent === 'vision';
            const visionLabelColor = isVisionActive ? 'yellow' : 'white';
            const navLabelColor = isNavActive ? 'yellow' : 'white';
            const visionLabelStyle = isVisionActive ? { bright: true } : { dim: true };
            const navLabelStyle = isNavActive ? { bright: true } : { dim: true };

            console.log(`${colorize(`Tab: ${session.label}`, 'cyan', { bright: true })}  ${colorize(`URL: ${truncateText(session.url)}`, 'white')}`);
            console.log('');
            console.log(colorize('Vision controller', visionLabelColor, visionLabelStyle));
            console.log(`  ${colorize(`Thought: ${truncateText(session.ui?.controllerThought || 'none', 140)}`, visionLabelColor, visionLabelStyle)}`);
            console.log('');
            console.log(colorize('Nav agent', navLabelColor, navLabelStyle));
            console.log(`  ${colorize(`Thought: ${truncateText(session.ui?.navThought || 'none', 140)}`, navLabelColor, navLabelStyle)}`);
            console.log('');
            console.log(colorize('Navigation feed (live):', 'yellow'));
            const navFeed = [...(session.ui?.navFeed || [])];
            const liveNavFocus = session.ui?.liveNavFocus || null;
            if (liveNavFocus && !navFeed.includes(liveNavFocus)) {
                navFeed.push(liveNavFocus);
            }
            const recentNavFeed = navFeed.slice(-5);
            if (!recentNavFeed.length) {
                console.log('Waiting for nav agent focus updates...');
            } else {
                recentNavFeed.forEach((entry, index) => {
                    const prefix = index === recentNavFeed.length - 1 ? '>' : ' ';
                    console.log(`${prefix} ${truncateText(entry, 140)}`);
                });
            }
            console.log('');
            console.log(colorize('Controller actions:', 'yellow'));
            const controllerActions = session.ui?.controllerActions || session.ui?.stepsCompleted || [];
            if (!controllerActions.length) {
                console.log('No controller actions recorded yet.');
            } else {
                controllerActions.slice(-8).reverse().forEach((event) => {
                    const when = new Date(event.timestamp).toLocaleTimeString();
                    console.log(`- [${when}] ${truncateText(event.message, 140)}`);
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

            if (key.name === 'h') {
                const sessions = getSessions?.() || [];
                const session = sessions[selectedIndex];
                if (session?.ui) {
                    session.ui.attention = true;
                    session.ui.blocked = false;
                    session.ui.completedByOperator = false;
                    session.ui.status = 'waiting';
                    session.ui.summary = 'needs attention';
                    session.ui.events = [
                        ...(session.ui.events || []),
                        { timestamp: new Date().toISOString(), message: 'requested help from operator' },
                    ].slice(-20);
                }
                render();
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
                resolveAttention(session, render);
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

        if (key.name === 'h') {
            const sessions = getSessions?.() || [];
            const session = sessions[selectedIndex];
            if (session?.ui) {
                session.ui.attention = true;
                session.ui.blocked = false;
                session.ui.completedByOperator = false;
                session.ui.status = 'waiting';
                session.ui.summary = 'needs attention';
                session.ui.events = [
                    ...(session.ui.events || []),
                    { timestamp: new Date().toISOString(), message: 'requested help from operator' },
                ].slice(-20);
            }
            render();
            return;
        }

        if (key.name === 'r') {
            const sessions = getSessions?.() || [];
            const session = sessions[selectedIndex];
            resolveAttention(session, render);
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
