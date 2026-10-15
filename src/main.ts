import './styles/main.css';
import { GameApp } from './ui/GameApp';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Elemento principal não encontrado.');

new GameApp(root).start();
