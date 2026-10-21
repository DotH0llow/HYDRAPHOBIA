import './styles/editor.css';
import { EditorApp } from './editor/EditorApp';
import { flushToDisk, pullAllFromDisk } from './systems/localSync';

const root = document.querySelector<HTMLElement>('#editor-app');
if (!root) throw new Error('Elemento do editor não encontrado.');

// O editor abre na versão mais recente entre o navegador e a cópia local em disco,
// para continuar de onde o projeto parou mesmo depois de um `git pull`.
await pullAllFromDisk();
window.addEventListener('pagehide', () => void flushToDisk());

new EditorApp(root).start();
