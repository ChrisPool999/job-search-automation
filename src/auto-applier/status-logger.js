import fs from 'fs';
import path from 'path';

export function createStatusLogger({ logDir, runLabel = 'run', consoleOutput = true } = {}) {
    if (!logDir) {
        throw new Error('createStatusLogger requires a logDir');
    }

    fs.mkdirSync(logDir, { recursive: true });

    const statusPath = path.join(logDir, 'status.jsonl');
    const humanLogPath = path.join(logDir, 'status.log');

    function writeEntry(level, message, data = {}) {
        const entry = {
            timestamp: new Date().toISOString(),
            runLabel,
            level,
            message,
            ...data,
        };

        const line = JSON.stringify(entry);
        fs.appendFileSync(statusPath, `${line}\n`, 'utf8');

        const details = Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : '';
        const humanLine = `[${entry.timestamp}] [${level.toUpperCase()}] [${runLabel}] ${message}${details}`;
        fs.appendFileSync(humanLogPath, `${humanLine}\n`, 'utf8');
        if (consoleOutput) {
            console.log(humanLine);
        }
    }

    return {
        info(message, data) {
            writeEntry('info', message, data);
        },
        warn(message, data) {
            writeEntry('warn', message, data);
        },
        error(message, data) {
            writeEntry('error', message, data);
        },
    };
}
