// 普通版联机页空桩：community 构建时经 vite alias 替换真实 MultiplayerPage（含陶瓦联机 / 异地联机面板），
// 与 LanPage / ServerPage 空桩一起，确保普通版 bundle 中不含任何联机 / 开服实现。
export default function MultiplayerPageStub() {
  return null;
}
