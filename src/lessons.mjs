import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const catalog = [
  { packages: ['react', 'react-dom'], title: 'How the interface reacts', kind: 'Frontend', body: 'React builds the interface from components. A change in state causes React to update the affected parts of the screen.', question: 'When a user clicks a button, what state should change?', answer: 'The state that represents the result of that action. The component renders the new state; it should not need to rebuild the whole page manually.' },
  { packages: ['next'], title: 'Where the browser meets the server', kind: 'Full stack', body: 'Next.js can render on the server and add interactive components in the browser. Keeping server work separate helps avoid sending secrets or unnecessary code to the browser.', question: 'Should a database password be available to a browser component?', answer: 'No. Keep credentials and direct database access on the server. The browser asks a server endpoint for the specific data it needs.' },
  { packages: ['express', 'fastify', 'hono'], title: 'What an endpoint does', kind: 'Backend', body: 'A server route receives an HTTP request, checks its inputs and permissions, performs work, and returns a response. A route is a boundary between callers and server logic.', question: 'Why validate inputs even if a form already checks them?', answer: 'A caller can bypass the form entirely. The server must check each request before acting on it.' },
  { packages: ['ws', 'socket.io'], title: 'A connection that stays open', kind: 'Realtime', body: 'A WebSocket lets the client and server send messages over an open connection. That makes it useful for status updates without repeatedly asking the server if anything changed.', question: 'What should the interface do if the connection drops?', answer: 'Show a disconnected state and reconnect. Fetch current state when reconnecting instead of replaying old actions that might interrupt the user.' },
  { packages: ['@supabase/supabase-js', 'pg', '@prisma/client', 'prisma'], title: 'Where application data lives', kind: 'Data', body: 'A database stores information across requests. The application controls which records each user can read or change; a successful connection alone does not establish authorization.', question: 'Does knowing a record ID mean a user can access that record?', answer: 'No. The server or database policies must verify that this user is allowed to access that specific record.' },
  { packages: ['vite'], title: 'From source files to a browser app', kind: 'Build tools', body: 'Vite provides a development server and a production build. The development server speeds up iteration; the production build prepares assets for deployment.', question: 'Does a successful build prove every user interaction works?', answer: 'No. It proves the build completed. User flows still need to be exercised in a browser.' },
];

export async function projectLessons(cwd) {
  try {
    const file = path.join(cwd, 'package.json');
    if ((await stat(file)).size > 128000) return [];
    const pkg = JSON.parse(await readFile(file, 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return catalog.flatMap(item => {
      const found = item.packages.filter(name => Object.hasOwn(deps, name));
      return found.length ? [{ ...item, packages: undefined, evidence: `Declared in package.json: ${found.join(', ')}` }] : [];
    });
  } catch { return []; }
}

export const activityLesson = {
  title: 'Read a change as a data journey', kind: 'Code reading',
  body: 'Start at a user action. Follow the request into a server handler, then into storage, and trace the response back to the interface. Some projects only contain a few of these steps.',
  question: 'What is the most useful question to ask about a new file?',
  answer: 'What calls this file, what information enters it, and what comes back? Those connections explain its role better than its filename alone.',
  evidence: 'General code-reading guidance. No supported dependencies detected yet.',
};
