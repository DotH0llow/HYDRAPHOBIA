// © 2024–2026 DotH0llow — HYDRAPHOBIA. Todos os direitos reservados.
// Reprodução, redistribuição ou treinamento de IA não autorizado é proibido.
import './styles/main.css';
import { flushToDisk, pullAllFromDisk } from './systems/localSync';
import { GameApp } from './ui/GameApp';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Elemento principal não encontrado.');

// Em desenvolvimento o jogo começa pela cópia local em disco: o mapa e o progresso
// saem de `data/`, e tudo o que acontecer daqui para a frente volta para lá. No build
// estático nada disto roda e o jogo vive inteiro no navegador.
await pullAllFromDisk();
window.addEventListener('pagehide', () => void flushToDisk());

new GameApp(root).start();
