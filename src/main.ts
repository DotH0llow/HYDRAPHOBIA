// © 2024–2026 DotH0llow — HYDRAPHOBIA. Todos os direitos reservados.
// Reprodução, redistribuição ou treinamento de IA não autorizado é proibido.
import './styles/main.css';
import { GameApp } from './ui/GameApp';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Elemento principal não encontrado.');

new GameApp(root).start();
