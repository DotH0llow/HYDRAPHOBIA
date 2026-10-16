import './styles/editor.css';
import { EditorApp } from './editor/EditorApp';

const root = document.querySelector<HTMLElement>('#editor-app');
if (!root) throw new Error('Elemento do editor não encontrado.');

new EditorApp(root).start();
