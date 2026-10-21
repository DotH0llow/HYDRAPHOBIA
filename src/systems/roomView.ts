import type { RoomMedia, RoomView } from '../config/world';

/**
 * Enquadramento da cena quando a sala define um campo de visão próprio.
 *
 * O padrão é a cena inteira: um quadro 16:9 ampliado até cobrir a janela, centralizado
 * (`.scene-frame` no CSS). Com uma janela menor, o mesmo quadro cresce até que apenas
 * aquele recorte cubra a tela e desliza para que o centro do recorte caia no centro da
 * janela. O quadro continua 16:9, então a imagem nunca distorce — o que muda é o quanto
 * dela chega à tela.
 *
 * Largura: o recorte ocupa `width`% do quadro, logo o quadro precisa ter
 * `100/width` vezes a largura da janela — e `100/height` vezes a altura, convertida
 * para a largura equivalente de um 16:9 (1 vh de altura vale 16/9 vw de largura).
 * O deslocamento é em % do próprio quadro, que é como o CSS lê `translate`.
 */
export const sceneFrameStyle = (view?: RoomView): string => {
  if (!view) return '';
  const width = Math.max(1, Math.min(100, view.width));
  const height = Math.max(1, Math.min(100, view.height));
  const frameWidth = `max(${(10000 / width).toFixed(3)}vw, ${(17777.778 / height).toFixed(3)}vh)`;
  const frameHeight = `max(${(5625 / width).toFixed(3)}vw, ${(10000 / height).toFixed(3)}vh)`;
  const centerX = (view.x + width / 2).toFixed(3);
  const centerY = (view.y + height / 2).toFixed(3);
  return `width:${frameWidth};height:${frameHeight};transform:translate(-${centerX}%,-${centerY}%)`;
};

/** Marcação de uma mídia solta sobre a cena, igual no jogo e no teste do editor. */
export const roomMediaMarkup = (media: readonly RoomMedia[] | undefined, onTop: boolean, escape: (value: unknown) => string): string =>
  (media ?? []).filter((entry) => Boolean(entry.path) && (entry.onTop === true) === onTop).map((entry) => {
    const body = entry.kind === 'video'
      ? `<video src="${escape(entry.path)}" autoplay muted playsinline ${entry.loop === false ? '' : 'loop'}></video>`
      : `<img src="${escape(entry.path)}" alt="" />`;
    return `<div class="scene-media-layer${onTop ? ' on-top' : ''}" aria-hidden="true" style="left:${entry.x}%;top:${entry.y}%;width:${entry.width}%;height:${entry.height}%;opacity:${entry.opacity ?? 1};transform:rotate(${entry.rotation ?? 0}deg)">${body}</div>`;
  }).join('');
