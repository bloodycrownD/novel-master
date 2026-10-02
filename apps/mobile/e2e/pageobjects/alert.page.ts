import {switchToNative} from '../helpers/context';

/**
 * Android 原生 `Alert` 的正文节点 resource-id（RN `Alert.alert` 直出原生对话框）。
 *
 * 为什么走 resourceId 而不是 `~`：本机 UiAutomator2 的 accessibility id 只按
 * content-desc 匹配，而原生 Alert 的 message TextView 没有 content-desc。
 */
const ALERT_MESSAGE = 'android=new UiSelector().resourceId("android:id/message")';

/** Android system Alert used for rollback confirmation. */
export class AlertPage {
  async acceptRollback(): Promise<void> {
    await switchToNative();
    try {
      await browser.acceptAlert();
      // 分支证据：acceptAlert 既能接「回滚确认」，也可能误接**恰好挂着的别的
      // 原生 alert**（如版本检查弹窗）——回滚确认根本没弹时流程会静默走偏
      // （2026-10-02 实跑：T-E2 报空 toast、库里消息原样=回滚没执行）。留日志
      // 定位用，读到「已 accept 但消息没滚」时先查这里。
      console.log('[e2e] acceptRollback: accepted via W3C acceptAlert');
      return;
    } catch {
      /* fall through to UiAutomator */
    }
    console.log('[e2e] acceptRollback: no W3C alert, waiting native message');
    // 回滚确认框正文是 `resolveRollbackConfirmMessage(mode, 'primary')`：
    // undo_send → 「将删除此消息及之后的对话」，rewind → 「将删除此消息之后的对话」。
    await this.acceptDestructive('将删除此消息', '回滚');
  }

  async dismiss(): Promise<void> {
    await switchToNative();
    try {
      await browser.dismissAlert();
    } catch {
      const cancel = await $('android=new UiSelector().text("取消")');
      if (await cancel.isExisting()) {
        await cancel.click();
      }
    }
  }

  /**
   * 读确认框正文再点破坏性按钮。
   *
   * 红线（不可逆操作禁止盲点确认框）：**先 dump 读到目标名称**，正文里必须出现
   * `mustContain` 指认的那段文字，否则直接抛错、绝不点确认——否则一旦列表顺序变了，
   * 删掉的就是隔壁那条数据。
   *
   * @param mustContain 正文里必须出现的片段（通常是「「项目名」」这种带书名号的目标名）
   * @param confirmLabel 确认按钮文案（删除项目/会话 =「删除」，回滚 =「回滚」）
   */
  async acceptDestructive(
    mustContain: string,
    confirmLabel: string,
  ): Promise<void> {
    await switchToNative();
    const message = await $(ALERT_MESSAGE);
    await message.waitForDisplayed({timeout: 8000});
    const text = await message.getText();
    if (!text.includes(mustContain)) {
      throw new Error(
        `[e2e] 破坏性确认框内容与目标不符，已放弃点击：期望正文含「${mustContain}」，实际「${text}」`,
      );
    }
    const confirm = await $(
      `android=new UiSelector().text("${confirmLabel}")`,
    );
    await confirm.waitForDisplayed({timeout: 5000});
    await confirm.click();
    await browser.pause(600);
  }
}

export const alertPage = new AlertPage();