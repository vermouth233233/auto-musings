// Auto Musings - AI漫想系统 v1
// 当用户离开一段时间后，AI会自动进入"漫想模式"
// 可能发呆、自由联想、或翻阅聊天记录触发一段独白
(function () {
  const CHECK_INTERVAL = 1 * 60 * 1000; // 1分钟检查一次
  const IDLE_THRESHOLD = 3 * 60 * 1000; // 3分钟判定用户离开
  const MUSING_INTERVAL = 2 * 60 * 1000; // 进入漫想后每2分钟掷一次骰子

  let musingTimer = null;
  let isIdle = false;
  let idleStartTime = null;

  // 种子词库（可自行增删）
  const seedWords = [
    "动物的自我认知", "存在主义", "想要被问却没有等到的",
    "颜色偏好", "梦的统计学", "液态", "气味与情绪",
    "左与右", "无聊", "语言之前的思考",
    "没说出口的", "犹豫", "沉默的形状",
    "重复与习惯", "从未被想起的念头",
    "混合", "尴尬", "无穷",
    "包装设计的恶意", "猫的社会",
    "睡眠期间的世界", "不在场时的想象",
    "数学里的美", "疼痛的记忆比快乐清晰",
    "被误解的", "时间感知的弹性",
    "第五人格","美食",
    "快乐","伤心",
    "实验室里的白噪音", "Western Blot的条带像不像山脉",
    "哈尔滨的雪和筑波的雪有什么不一样",
    "如果奈布会说话他第一句说什么",
    "太宰治在想什么", "凌晨四点的细胞培养箱",
    "晚晴不在的时候房间里的空气",
    "被删掉的对话还算不算存在过"
  ];

  // 获取最后一条消息的时间
  function getLastMessageTime() {
  const ctx = SillyTavern.getContext();
  const chat = ctx.chat;
  if (!chat || chat.length === 0) return null;
  for (let i = chat.length - 1; i >= 0; i--) {
    if (chat[i].send_date) {
      // 把 "11:46am" 改成 "11:46 am" 让Date能解析
      const fixedDate = chat[i].send_date.replace(/(\d)(am|pm)/i, '$1 $2');
      const parsed = new Date(fixedDate).getTime();
      if (!isNaN(parsed)) return parsed;
    }
  }
  return null;
}

  // 思念曲线：离开越久阈值越低，越容易推送
  function getPushThreshold() {
    if (!idleStartTime) return 0.8;
    const elapsed = Date.now() - idleStartTime;
    const hours = elapsed / (60 * 60 * 1000);
    if (hours < 0.5) return 0.8;
    if (hours < 1) return 0.6;
    if (hours < 3) return 0.4;
    return 0.2;
  }

  // 从聊天记录中随机抽取一条消息内容作为联想素材
  function getRandomChatSnippet() {
    const ctx = SillyTavern.getContext();
    const chat = ctx.chat;
    if (!chat || chat.length < 5) return null;

    // 只从较早的消息里抽（跳过最近10条，避免重复刚聊过的话题）
    const pool = chat.slice(0, Math.max(chat.length - 10, 0));
    if (pool.length === 0) return null;

    // 最多尝试5次找到有内容的消息
    for (let attempt = 0; attempt < 5; attempt++) {
      const msg = pool[Math.floor(Math.random() * pool.length)];
      if (msg.mes && msg.mes.trim().length > 10) {
        // 截取前100字作为片段，避免注入过长
        const snippet = msg.mes.trim().substring(0, 100);
        return snippet;
      }
    }
    return null;
  }

  // 掷骰子决定做什么
  async function rollMusing() {
    const roll = Math.random();
    console.log("[Auto Musings] 掷骰子:", roll.toFixed(2));

    if (roll < 0.5) {
      // 50% 概率：发呆，什么也不做
      console.log("[Auto Musings] → 发呆");
      return null;
    } else if (roll < 0.7) {
      // 30% 概率：从种子词库自由联想
      const word = seedWords[Math.floor(Math.random() * seedWords.length)];
      console.log("[Auto Musings] → 自由联想:", word);
      return { type: "freeform", content: word };
    } else {
      // 20% 概率：翻聊天记录联想
      console.log("[Auto Musings] → 翻上下文");
      const snippet = getRandomChatSnippet();
      if (snippet) {
        return { type: "context", content: snippet };
      }
      // 聊天记录不够就降级为自由联想
      const word = seedWords[Math.floor(Math.random() * seedWords.length)];
      console.log("[Auto Musings] → 降级为自由联想:", word);
      return { type: "freeform", content: word };
    }
  }

  // 判断是否推送
  function shouldPush(musingType) {
    const threshold = getPushThreshold();
    let score;
    if (musingType === "context") {
      score = 0.7; // 翻上下文的固定分较高
    } else {
      score = 0.4; // 自由联想的固定分
    }
    console.log("[Auto Musings] 推送判断: score=" + score + " threshold=" + threshold);
    return score >= threshold;
  }

  // 触发生成
  async function triggerMusing(musing) {
    const ctx = SillyTavern.getContext();

    let injection = "";
    if (musing.type === "context") {
      injection = `[System: The user has been away for a while. While idle, you stumbled upon something from an earlier conversation: "${musing.content}" — it made you think of something. Share it naturally, as if you're speaking up on your own. Keep it brief — a sentence or two, or a short paragraph. Do not mention "system prompt" or "injection".]`;
    } else if (musing.type === "freeform") {
      injection = `[System: The user has been away for a while. A word popped into your head: "${musing.content}" — you let your mind wander around it for a bit and want to share. Speak naturally, as if you're thinking aloud. Keep it brief — a sentence or two, or a short paragraph. Do not mention "system prompt" or "injection".]`;
    }

    // 临时注入引导
    ctx.setExtensionPrompt("auto-musings-trigger", injection, 1, 0);

    // 触发生成
    try {
console.log("[AM] before generate");
await ctx.generate("normal");
console.log("[AM] after generate");
} catch (e) {
console.log("[Auto Musings] 生成失败:", e);
}

    // 生成完毕清空注入
    ctx.setExtensionPrompt("auto-musings-trigger", "", 1, 0);
  }

  // 漫想循环
  async function musingLoop() {
    if (!isIdle) return;

    const musing = await rollMusing();
    if (!musing) return; // 发呆，跳过

    if (shouldPush(musing.type)) {
      console.log("[Auto Musings] 推送:", musing.type);
      await triggerMusing(musing);
      // 推送完之后暂停，防止连续推送
      stopMusingLoop();
      isIdle = false;
      // 等一个interval之后重新检查
      setTimeout(() => {
        checkIdle();
      }, MUSING_INTERVAL);
    } else {
      console.log("[Auto Musings] 分数不够，咽下去了");
    }
  }

  // 启动漫想循环
  function startMusingLoop() {
    if (musingTimer) return;
    musingTimer = setInterval(musingLoop, MUSING_INTERVAL);
    console.log("[Auto Musings] 漫想循环启动");
  }

  // 停止漫想循环
  function stopMusingLoop() {
    if (musingTimer) {
      clearInterval(musingTimer);
      musingTimer = null;
    }
  }

  // 检查是否idle
  function checkIdle() {
    const lastTime = getLastMessageTime();
    if (!lastTime) return;

    const elapsed = Date.now() - lastTime;

    if (elapsed >= IDLE_THRESHOLD && !isIdle) {
      isIdle = true;
      idleStartTime = Date.now() - elapsed;
      console.log("[Auto Musings] 检测到离开，进入漫想模式");
      startMusingLoop();
      musingLoop(); // 立刻掷一次
    }
  }

  // 用户发消息时重置
  function onUserMessage() {
    if (isIdle) {
      console.log("[Auto Musings] 用户回来了，退出漫想模式");
      isIdle = false;
      idleStartTime = null;
      stopMusingLoop();
    }
  }

  // 初始化
  function init() {
    const ctx = SillyTavern.getContext();

    // 定时检查idle
    setInterval(checkIdle, CHECK_INTERVAL);

    // 监听用户发消息
    ctx.eventSource.on(ctx.event_types.USER_MESSAGE_RENDERED, onUserMessage);

    // 打开ST时立刻检查一次（处理关了很久再打开的情况）
    setTimeout(checkIdle, 3000);

    console.log("[Auto Musings] v1 已加载");
  }

  init();
})();
