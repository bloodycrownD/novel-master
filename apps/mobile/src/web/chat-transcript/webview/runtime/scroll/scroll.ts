import {NEAR_BOTTOM_THRESHOLD_PX} from '@web/shared/constants';
import {ScrollMath} from '@web/shared/scroll-math';
import {state, SCHEMA_V} from '../state/state';
import {post} from '../bridge';
import {RowWindow} from '../render/row-windowing';
/**
 * 滚动锚点、贴底与加载更早消息。公式单源：`web/shared/scroll-math.ts`，
 * 本文件只做 DOM「取值 → 调公式 → 写回」。
 */
const SCROLL_TOP_LOAD_OLDER = 24;

/** 防抖定时器槽（模块内 holder，对象管理）。 */
const scrollTimerSlot = {
    timer: null as ReturnType<typeof setTimeout> | null,
};

export const Scroll = {
    offsetFromBottom: (el: HTMLElement): number => {
        return ScrollMath.offsetFromBottom(el.scrollTop, el.scrollHeight, el.clientHeight);
    },

    isNearBottom: (el: HTMLElement): boolean => {
        return ScrollMath.isNearBottomOffset(Scroll.offsetFromBottom(el), NEAR_BOTTOM_THRESHOLD_PX);
    },

    stickToBottom: (el: HTMLElement): void => {
        el.scrollTop = ScrollMath.scrollTopForBottom(el.scrollHeight, el.clientHeight);
        state.nearBottom = true;
    },

    /** Tail shrink (rollback): prevScrollTop may exceed new max — clamp to avoid bubble jump. */
    clampTop: (el: HTMLElement, prevScrollTop: number): void => {
        el.scrollTop = ScrollMath.clampScrollTop(prevScrollTop, el.scrollHeight, el.clientHeight);
    },

    scheduleStickIfNearBottom: (): void => {
        if (!state.nearBottom) return;
        if (state.scrollRaf != null) return;
        state.scrollRaf = requestAnimationFrame(function () {
            state.scrollRaf = null;
            const scroller = document.getElementById('scroller');
            if (scroller) Scroll.stickToBottom(scroller);
        });
    },

    /**
   * 视口高度变化时的即时贴底（键盘顶起后消息「迟到上跳」修，2026-10-01）。
   *
   * 病灶：键盘弹起让 dock 留白经 200ms 过渡归零 → #scroller 的 clientHeight
   * **变大** Δ，浏览器对「视口变大」不补偿 scrollTop → 末条消息底下悄悄空出
   * Δ 的缝（offsetFromBottom 被 Math.max 夹 0，nearBottom 仍真、谁也看不见），
   * 直到下一次流式/快照贴底事件才把 scrollTop += Δ 一次性吸回——用户看到的
   * 就是「位置一直不动，突然跳到输入框上方」。视口**变小**方向无此病（浏览器
   * 钳制自动贴回）。
   *
   * 修法语义（写死，免得日后当 bug 查）：**凡 #scroller 视口高度变化，贴底
   * 用户立即跟随、非贴底用户一个像素不动**——由 bind-shell-events 的
   * ResizeObserver 逐帧调用（键盘裁切的每帧、dock 过渡的每帧、输入框换行
   * 长高、chips 显隐都覆盖）。判据只用 state.nearBottom（全仓唯一贴底真源），
   * 不做「按 offsetFromBottom 补偿」——那会把向上翻历史的用户整屏下拽。
   */
    stickIfNearBottomNow: (): void => {
        const scroller = document.getElementById('scroller');
        if (scroller == null || !state.nearBottom) {
            return;
        }
        Scroll.stickToBottom(scroller);
    },

    emitSnapshot: (): void => {
        const scroller = document.getElementById('scroller');
        if (!scroller) return;
        const off = Scroll.offsetFromBottom(scroller);
        const near = ScrollMath.isNearBottomOffset(off, NEAR_BOTTOM_THRESHOLD_PX);
        state.nearBottom = near;
        post('scrollSnapshot', {
            schemaVersion: SCHEMA_V,
            offsetY: off,
            nearBottom: near,
            scrollHeight: scroller.scrollHeight,
            clientHeight: scroller.clientHeight,
        });
    },

    requestLoadOlder: (): void => {
        if (!state.hasMore || !state.loadOlderArmed) return;
        state.loadOlderArmed = false;
        post('loadOlder', {});
    },

    on: (): void => {
        const scroller = document.getElementById('scroller');
        if (!scroller) return;
        state.nearBottom = Scroll.isNearBottom(scroller);
        // 窗口化（Step 7）：滚动近界扩窗 / 远界收缩（幂等；上端移动自带
        // scrollHeight 差值补偿，不产生读位跳动）。
        RowWindow.handleScroll();
        if (scroller.scrollTop <= SCROLL_TOP_LOAD_OLDER) {
            Scroll.requestLoadOlder();
        }
        if (scrollTimerSlot.timer != null) return;
        scrollTimerSlot.timer = setTimeout(function () {
            scrollTimerSlot.timer = null;
            Scroll.emitSnapshot();
        }, 100);
    },
} as const;
