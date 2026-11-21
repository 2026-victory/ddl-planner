/*
 * PlannerCore —— 纯逻辑核心（无 DOM 依赖，可在 Node 中单测）
 * 负责：任务模型 / 优先级排序 / 工时预估 / 智能拆解 / 每日排程 / 中文自然语言解析 / ICS 导出
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlannerCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MS_DAY = 86400000;
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var DEFAULT_SETTINGS = {
    workStart: '08:30',
    workEnd: '22:30',
    focusMax: 45,      // 单个时间块最长（分钟）
    breakLen: 15,      // 块间休息（分钟）
    minSlice: 15,      // 小于该值不再切块
    reminders: true,
    remindBefore: 10,  // 默认提前提醒分钟数
    capacityWarn: 0.9
  };

  /* ------------------------------------------------------------------ *
   * 基础工具
   * ------------------------------------------------------------------ */
  function pad2(n) { return String(n).padStart(2, '0'); }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /** 只把 undefined / null 当作缺失，0 是合法值 */
  function numOr(v, fallback) {
    return (v === undefined || v === null || v === '' || isNaN(v)) ? fallback : Number(v);
  }

  function toISO(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayISO() { return toISO(new Date()); }

  function parseISO(iso) {
    var p = String(iso).split('-').map(Number);
    return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
  }

  function addDaysISO(iso, n) {
    var d = parseISO(iso);
    d.setDate(d.getDate() + n);
    return toISO(d);
  }

  function daysBetween(fromISO, toISOStr) {
    var a = parseISO(fromISO), b = parseISO(toISOStr);
    return Math.round(
      (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
        Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / MS_DAY
    );
  }

  function weekdayOf(iso) { return WEEKDAYS[parseISO(iso).getDay()]; }

  function daysInMonth(year, monthIndex) { return new Date(year, monthIndex + 1, 0).getDate(); }

  function minutesOf(hhmm) {
    var p = String(hhmm || '0:0').split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }

  function clockOf(min) {
    min = Math.round(min);
    return pad2(Math.floor(min / 60)) + ':' + pad2(((min % 60) + 60) % 60);
  }

  function fmtDuration(min) {
    min = Math.max(0, Math.round(min || 0));
    if (min < 60) return min + '分钟';
    var h = Math.floor(min / 60), m = min % 60;
    return m === 0 ? h + '小时' : h + '小时' + m + '分';
  }

  function fmtHours(min) {
    var h = (min || 0) / 60;
    if (h === 0) return '0h';
    return (h >= 10 ? Math.round(h) : Math.round(h * 10) / 10) + 'h';
  }

  function shortTitle(str, max) {
    str = String(str || '').trim();
    max = max || 12;
    return str.length > max ? str.slice(0, max) + '…' : str;
  }

  /* ------------------------------------------------------------------ *
   * 任务模型
   * ------------------------------------------------------------------ */
  function normalizeTask(t) {
    var task = Object.assign({
      id: uid(),
      title: '未命名任务',
      note: '',
      due: null,
      dueTime: null,
      estimate: null,
      spent: 0,
      difficulty: 3,
      importance: 3,
      done: false,
      doneAt: null,
      createdAt: todayISO(),
      subtasks: [],
      // —— 新增 ——
      repeat: null,        // { freq:'weekly', weekday:1, weekdays:[1,4], until:'2026-12-31' }
      fixedStart: null,    // '19:00' 指定时间段开始（会锁定排程）
      fixedEnd: null,      // '20:30'
      seriesId: null,      // 同一重复系列共享的 id
      remindBefore: null,  // 该任务单独设置提前提醒分钟数；null=用全局默认
      isEvent: false       // true=固定安排（不做完成勾选、不需提醒）
    }, t || {});
    task.difficulty = clamp(Math.round(numOr(task.difficulty, 3)), 1, 5);
    task.importance = clamp(Math.round(numOr(task.importance, 3)), 1, 5);
    task.estimate = Math.max(0, Math.round(numOr(task.estimate, 0)));
    task.spent = Math.max(0, Math.round(numOr(task.spent, 0)));
    task.note = task.note || '';
    task.isEvent = !!task.isEvent;
    // 单独的提醒时间：null 表示跟随全局设置；0 表示不提醒
    if (task.remindBefore === undefined || task.remindBefore === null || task.remindBefore === '') {
      task.remindBefore = null;
    } else {
      task.remindBefore = clamp(Math.round(numOr(task.remindBefore, 10)), 0, 1440);
    }

    // 重复规则规范化
    if (task.repeat && task.repeat.freq) {
      var r = task.repeat;
      var freq = String(r.freq);
      if (freq !== 'daily' && freq !== 'weekly' && freq !== 'monthly' && freq !== 'weekday') freq = 'weekly';
      var wds = (r.weekdays && r.weekdays.length)
        ? r.weekdays.map(function (x) { return clamp(Math.round(numOr(x, 1)), 0, 6); })
            .filter(function (x, i, arr) { return arr.indexOf(x) === i; })
            .sort(function (a, b) { return a - b; })
        : null;
      task.repeat = {
        freq: freq,
        weekday: (r.weekday === null || r.weekday === undefined)
          ? (wds && wds.length ? wds[0] : parseISO(task.due || todayISO()).getDay())
          : clamp(Math.round(numOr(r.weekday, 1)), 0, 6),
        weekdays: wds,
        monthDay: clamp(Math.round(numOr(r.monthDay, 1)), 1, 31),
        until: r.until || null,
        count: r.count || null
      };
    } else {
      task.repeat = null;
    }

    // 固定时间段规范化
    if (task.fixedStart && task.fixedEnd) {
      task.fixedStart = String(task.fixedStart).slice(0, 5);
      task.fixedEnd = String(task.fixedEnd).slice(0, 5);
      if (minutesOf(task.fixedEnd) <= minutesOf(task.fixedStart)) {
        task.fixedEnd = clockOf(minutesOf(task.fixedStart) + 60);
      }
      // 有固定时间段时，工时与时段保持一致
      var span = minutesOf(task.fixedEnd) - minutesOf(task.fixedStart);
      if (!task.subtasks.length) task.estimate = span;
    } else {
      task.fixedStart = null;
      task.fixedEnd = null;
    }

    task.subtasks = (task.subtasks || []).map(function (s, i) {
      return {
        id: s.id || uid(),
        title: s.title || '子任务 ' + (i + 1),
        estimate: Math.max(0, Math.round(s.estimate || 0)),
        done: !!s.done,
        doneAt: s.doneAt || null,
        suggestedDate: s.suggestedDate || null,
        phase: s.phase || null
      };
    });
    if (!task.title) task.title = '未命名任务';
    // 没填工时且没有子任务时，按标题类型自动估一个
    if (!task.subtasks.length && task.estimate <= 0) {
      task.estimate = guessEstimate(task.title + ' ' + task.note, task.difficulty);
    }
    return task;
  }

  /** 剩余预估工时（分钟） */
  function remainingMinutes(task) {
    if (task.done) return 0;
    if (task.subtasks && task.subtasks.length) {
      return task.subtasks.reduce(function (s, x) {
        return s + (x.done ? 0 : Math.max(0, x.estimate || 0));
      }, 0);
    }
    return Math.max(0, (task.estimate || 0) - (task.spent || 0));
  }

  /** 总预估工时（子任务优先） */
  function totalEstimate(task) {
    if (task.subtasks && task.subtasks.length) {
      return task.subtasks.reduce(function (s, x) { return s + (x.estimate || 0); }, 0);
    }
    return task.estimate || 0;
  }

  /** 完成度 0~100 */
  function progressOf(task) {
    if (task.done) return 100;
    var total = totalEstimate(task);
    if (total <= 0) return 0;
    return clamp(Math.round(((total - remainingMinutes(task)) / total) * 100), 0, 100);
  }

  function daysLeft(task, today) {
    if (!task.due) return null;
    return daysBetween(today || todayISO(), task.due);
  }

  /** 状态：done | overdue | today | soon | later | anytime */
  function statusOf(task, today) {
    if (task.done) return 'done';
    if (task.isEvent) return 'event';       // 固定安排没有"到期"概念
    var dl = daysLeft(task, today);
    if (dl === null) return 'anytime';
    if (dl < 0) return 'overdue';
    if (dl === 0) return 'today';
    if (dl <= 3) return 'soon';
    return 'later';
  }

  function dueLabel(task, today) {
    today = today || todayISO();
    if (!task.due) return '无期限';
    var dl = daysBetween(today, task.due);
    var date = parseISO(task.due);
    var text;
    if (dl < 0) text = '已逾期 ' + Math.abs(dl) + ' 天';
    else if (dl === 0) text = '今天';
    else if (dl === 1) text = '明天';
    else if (dl === 2) text = '后天';
    else if (dl <= 6) text = WEEKDAYS[date.getDay()];
    else text = (date.getMonth() + 1) + '月' + date.getDate() + '日';
    if (task.dueTime && dl >= 0) text += ' ' + task.dueTime;
    return text;
  }

  /* ------------------------------------------------------------------ *
   * 智能排序：紧急度 × 重要度 × 难度 × 工作量
   * ------------------------------------------------------------------ */
  function scoreOf(task, today) {
    today = today || todayISO();
    var remain = remainingMinutes(task);
    var dl = daysLeft(task, today);
    var impN = (task.importance - 1) / 4;
    var diffN = (task.difficulty - 1) / 4;
    var effortN = clamp(remain / 480, 0, 1);

    // 每天可为单个任务投入的深度工作时间按 3 小时计
    var requiredDays = Math.max(0.25, remain / 180);
    var urgency;
    if (dl === null) urgency = 0.22;
    else if (dl <= 0) urgency = 1;
    else urgency = clamp(Math.pow(requiredDays / dl, 0.6), 0, 1);

    // 临近截止的兜底压力
    if (dl !== null) {
      if (dl <= 0) urgency = 1;
      else if (dl <= 1) urgency = Math.max(urgency, 0.86);
      else if (dl <= 3) urgency = Math.max(urgency, 0.64);
      else if (dl <= 7) urgency = Math.max(urgency, 0.45);
    }
    if (task.done) urgency = 0;

    var score = Math.round(100 * (
      0.40 * urgency +
      0.30 * impN +
      0.15 * diffN +
      0.15 * effortN
    ));

    // 临期加成：快到期的事情强制往前排，避免被“大任务”挤掉
    if (dl !== null && dl >= 0) {
      if (dl <= 1) score += 15;
      else if (dl <= 3) score += 8;
    }

    var reasons = [];
    if (dl !== null && dl < 0) reasons.push('已逾期 ' + Math.abs(dl) + ' 天');
    else if (dl === 0) reasons.push('今天截止');
    else if (dl === 1) reasons.push('明天截止');
    else if (dl !== null && dl <= 3) reasons.push(dl + ' 天后截止');
    if (task.importance >= 4) reasons.push('重要度高');
    if (task.difficulty >= 4) reasons.push('难度大，宜早开始');
    if (remain >= 180) reasons.push('还需 ' + fmtDuration(remain));
    if (!reasons.length) reasons.push('按重要度与工作量排序');

    return {
      score: clamp(score, 0, 100),
      urgency: urgency,
      remain: remain,
      daysLeft: dl,
      reasons: reasons
    };
  }

  function sortTasks(tasks, today) {
    today = today || todayISO();
    return (tasks || [])
      .map(function (t) {
        var s = scoreOf(t, today);
        return { task: t, score: s.score, meta: s };
      })
      .sort(function (a, b) {
        if (a.task.done !== b.task.done) return a.task.done ? 1 : -1;
        if (b.score !== a.score) return b.score - a.score;
        var ad = a.task.due || '9999-99-99';
        var bd = b.task.due || '9999-99-99';
        return ad < bd ? -1 : ad > bd ? 1 : 0;
      });
  }

  /* ------------------------------------------------------------------ *
   * 大任务拆解：领域专家规则库 + 工时按权重分配 + 阶段性建议日期
   * ------------------------------------------------------------------ */
  var DOMAIN_RULES = [
    {
      key: 'thesis', label: '论文/研究', test: /论文|文献|开题|毕设|毕业设计|综述|期刊|投稿|研究|课题|实验/,
      steps: [
        ['明确选题与完成标准', 0.07],
        ['检索并筛选核心文献', 0.10],
        ['精读文献、整理笔记卡片', 0.13],
        ['搭好论文框架与提纲', 0.08],
        ['撰写引言与文献综述', 0.14],
        ['完成方法 / 实验与数据分析', 0.18],
        ['撰写结果与讨论', 0.12],
        ['写结论与摘要', 0.06],
        ['格式校对、查重与定稿提交', 0.12]
      ]
    },
    {
      key: 'code', label: '编程/项目', test: /编程|代码|开发|小程序|app|网站|系统|上线|部署|bug|接口|数据库|算法|项目/,
      steps: [
        ['写清需求与验收标准', 0.07],
        ['技术选型、环境与项目骨架', 0.08],
        ['设计数据模型与接口', 0.10],
        ['实现核心功能（先跑通主流程）', 0.30],
        ['补齐周边功能并联调', 0.15],
        ['自测、修 Bug、处理边界情况', 0.15],
        ['优化体验与性能', 0.08],
        ['部署上线、写使用文档', 0.07]
      ]
    },
    {
      key: 'homework', label: '作业/习题', test: /作业|习题|练习|题目|实验报告|课后题|卷子|试卷|题单/,
      steps: [
        ['看清题目要求与评分点', 0.10],
        ['回顾对应知识点与例题', 0.20],
        ['先做会的部分，标记卡住的', 0.30],
        ['集中攻克难题（查资料 / 问人）', 0.22],
        ['检查计算与书写规范', 0.10],
        ['整理错题、归档提交', 0.08]
      ]
    },
    {
      key: 'exam', label: '考试/备考', test: /考试|复习|备考|考研|期末|期中|四六级|雅思|托福|考证|证书|高数|线代|大物|背单词/,
      steps: [
        ['梳理考纲、题型与分值', 0.08],
        ['通读教材 / 笔记建立框架', 0.15],
        ['整理知识清单与错题本', 0.12],
        ['分章节刷题（配错题复盘）', 0.28],
        ['限时真题模拟', 0.20],
        ['查漏补缺与背诵冲刺', 0.12],
        ['考前状态调整与物品准备', 0.05]
      ]
    },
    {
      key: 'report', label: '汇报/PPT', test: /汇报|ppt|演示|课件|述职|答辩ppt|路演|总结报告|方案|提案|周报|月报/,
      steps: [
        ['明确汇报对象与核心结论', 0.08],
        ['收集数据、素材与案例', 0.14],
        ['搭逻辑框架与大纲', 0.10],
        ['做出内容初版', 0.28],
        ['设计版式、图表与配图', 0.18],
        ['试讲 / 通读并修改', 0.13],
        ['导出备份、按格式提交', 0.09]
      ]
    },
    {
      key: 'design', label: '设计/创作', test: /设计|海报|封面|ui|视觉|插画|排版|logo|banner|作品集/,
      steps: [
        ['明确需求、尺寸与参考收集', 0.12],
        ['画草图 / 线框方案', 0.15],
        ['确定视觉方向与配色', 0.10],
        ['完成主画面', 0.30],
        ['补齐其余页面 / 尺寸', 0.15],
        ['细节打磨与规范整理', 0.10],
        ['导出交付源文件', 0.08]
      ]
    },
    {
      key: 'speech', label: '演讲/答辩', test: /演讲|答辩|presentation|路演|宣讲|发言|汇报演出|面试讲/,
      steps: [
        ['明确主题、听众与时长', 0.08],
        ['写讲稿结构与关键句', 0.18],
        ['制作演示稿', 0.20],
        ['逐段练习并录音', 0.25],
        ['计时精简到规定时长', 0.12],
        ['准备可能的提问与回答', 0.12],
        ['现场彩排与设备检查', 0.05]
      ]
    },
    {
      key: 'event', label: '活动/出行', test: /活动|聚会|旅行|旅游|出差|婚礼|生日|团建|会议|展会|搬家/,
      steps: [
        ['明确目标、预算与人数', 0.10],
        ['制定流程与时间表', 0.12],
        ['预订 / 采购所需资源', 0.20],
        ['分工并通知相关人', 0.10],
        ['准备物料与检查清单', 0.15],
        ['现场执行与应变', 0.25],
        ['收尾、结算与复盘', 0.08]
      ]
    },
    {
      key: 'job', label: '求职/面试', test: /求职|简历|面试|找工作|秋招|春招|内推|投递|offer|实习/,
      steps: [
        ['锁定目标岗位与行业', 0.08],
        ['梳理经历与项目亮点', 0.15],
        ['撰写 / 更新简历', 0.20],
        ['投递与寻找内推', 0.15],
        ['准备高频面试题与自我介绍', 0.20],
        ['模拟面试并复盘', 0.12],
        ['跟进结果与复盘迭代', 0.10]
      ]
    },
    {
      key: 'writing', label: '写作/内容', test: /写作|文章|公众号|文案|小说|剧本|推文|书稿|稿件|博客|笔记输出/,
      steps: [
        ['定选题与切入角度', 0.08],
        ['收集素材与案例', 0.15],
        ['列提纲、定结构', 0.10],
        ['写完整初稿', 0.35],
        ['改结构、改语言', 0.17],
        ['配图排版与校对', 0.07],
        ['发布与推广', 0.08]
      ]
    },
    {
      key: 'study', label: '学习/课程', test: /学习|课程|网课|教程|掌握|入门|自学|培训|上课|看书|读书|读完|听书|刷完|真题讲解/,
      steps: [
        ['明确学习目标与资料清单', 0.08],
        ['快速通读，建立整体框架', 0.17],
        ['逐节精学并做笔记', 0.30],
        ['动手练习 / 输出小作品', 0.25],
        ['整理疑问与错题', 0.12],
        ['复述总结、检验掌握程度', 0.08]
      ]
    },
    {
      key: 'general', label: '通用', test: /./,
      steps: [
        ['明确目标与完成标准', 0.08],
        ['收集资料与所需工具', 0.12],
        ['拆出关键步骤并列清单', 0.10],
        ['完成核心部分（先做第一版）', 0.35],
        ['补充细节、查漏补缺', 0.15],
        ['检查修改与定稿', 0.12],
        ['交付 / 收尾', 0.08]
      ]
    }
  ];

  var PHASES = ['启动', '推进', '收尾'];

  function detectDomain(text) {
    var s = String(text || '');
    for (var i = 0; i < DOMAIN_RULES.length; i++) {
      if (DOMAIN_RULES[i].test.test(s)) return DOMAIN_RULES[i];
    }
    return DOMAIN_RULES[DOMAIN_RULES.length - 1];
  }

  /**
   * 拆解大任务：返回子任务数组（含工时、阶段、建议完成日期）
   * @param {object} task
   * @param {string} today
   * @param {object} [opts] { estimate: 覆盖总工时 }
   */
  function breakdown(task, today, opts) {
    today = today || todayISO();
    opts = opts || {};
    var domain = detectDomain((task.title || '') + ' ' + (task.note || ''));
    var base = Math.max(opts.estimate || 0, task.estimate || 0, remainingMinutes(task));
    if (!base) base = guessEstimate((task.title || '') + ' ' + (task.note || ''), task.difficulty);
    var allSteps = domain.steps;
    // 工时太少时不硬凑步骤：每步至少 20 分钟才有意义
    var maxSteps = Math.max(3, Math.floor(base / 20));
    var steps = allSteps;
    if (allSteps.length > maxSteps) {
      steps = [];
      for (var si = 0; si < maxSteps; si++) {
        var idx0 = Math.round(si * (allSteps.length - 1) / (maxSteps - 1));
        steps.push(allSteps[idx0]);
      }
    }
    var total = Math.max(base, steps.length * 15);

    // 难度越高，准备与检查环节占比略增
    var diff = task.difficulty || 3;
    var weights = steps.map(function (s) { return s[1]; });
    if (diff >= 4 && weights.length > 4) {
      weights[0] += 0.03;
      weights[weights.length - 1] += 0.02;
      weights[3] = Math.max(0.05, weights[3] - 0.05);
    }

    var sumW = weights.reduce(function (a, b) { return a + b; }, 0);
    var raw = weights.map(function (w) { return (w / sumW) * total; });
    var mins = raw.map(function (m) { return Math.max(15, Math.round(m / 5) * 5); });

    // 修正总和，保证与预估一致
    var diffTotal = total - mins.reduce(function (a, b) { return a + b; }, 0);
    if (diffTotal !== 0) {
      if (diffTotal < 0) {
        // 需要压缩：从工时最大的步骤里逐步扣，最低 15 分钟
        var guard = 0;
        while (diffTotal < 0 && guard++ < 500) {
          var idx = -1, best = 15;
          for (var j = 0; j < mins.length; j++) {
            if (mins[j] > best) { best = mins[j]; idx = j; }
          }
          if (idx < 0) break;
          mins[idx] -= 5;
          diffTotal += 5;
        }
      } else {
        var maxIdx = 0;
        for (var k = 1; k < mins.length; k++) if (mins[k] > mins[maxIdx]) maxIdx = k;
        mins[maxIdx] += diffTotal;
      }
    }

    var days = task.due ? Math.max(0, daysBetween(today, task.due)) : 0;
    var cumulative = 0;
    var out = steps.map(function (step, idx) {
      cumulative += weights[idx] / sumW;
      var suggestedDate = null;
      if (task.due) {
        var offset = days <= 0 ? 0 : Math.min(days, Math.floor(cumulative * days));
        suggestedDate = addDaysISO(today, offset);
      }
      var phase = idx === 0 ? PHASES[0]
        : idx === steps.length - 1 ? PHASES[2]
        : PHASES[1];
      return {
        id: uid(),
        title: step[0],
        estimate: mins[idx],
        done: false,
        doneAt: null,
        suggestedDate: suggestedDate,
        phase: phase
      };
    });
    return { domain: domain.key, domainLabel: domain.label, subtasks: out, total: total };
  }

  /* ------------------------------------------------------------------ *
   * 重复任务：把一条任务展开成一整个系列
   * ------------------------------------------------------------------ */
  var REPEAT_LABELS = {
    daily: '每天',
    weekday: '工作日',
    weekly: '每周',
    monthly: '每月'
  };

  function repeatLabel(repeat) {
    if (!repeat) return '';
    if (repeat.freq === 'daily') return '每天';
    if (repeat.freq === 'weekday') return '每个工作日';
    if (repeat.freq === 'monthly') return '每月 ' + (repeat.monthDay || 1) + ' 日';
    if (repeat.freq === 'weekly') {
      var list = (repeat.weekdays && repeat.weekdays.length)
        ? repeat.weekdays
        : [repeat.weekday === undefined ? 1 : repeat.weekday];
      if (list.length === 1) return '每' + WEEKDAYS[list[0]];
      if (list.length === 7) return '每天';
      return '每' + list.map(function (d) { return WEEKDAYS[d].replace('周', ''); }).join('、');
    }
    return '';
  }

  /** 判断某天是否命中重复规则 */
  function hitsOn(repeat, iso) {
    if (!repeat) return false;
    var d = parseISO(iso);
    var dow = d.getDay();
    if (repeat.freq === 'daily') return true;
    if (repeat.freq === 'weekday') return dow >= 1 && dow <= 5;
    if (repeat.freq === 'monthly') {
      var want = repeat.monthDay || 1;
      var dim = daysInMonth(d.getFullYear(), d.getMonth());
      return d.getDate() === Math.min(want, dim);
    }
    if (repeat.freq === 'weekly') {
      // 支持多选星期（weekdays 数组），否则用单个 weekday
      var list = (repeat.weekdays && repeat.weekdays.length)
        ? repeat.weekdays
        : [repeat.weekday === undefined ? 1 : repeat.weekday];
      return list.indexOf(dow) !== -1;
    }
    return false;
  }

  /**
   * 生成重复实例日期列表
   * @param {object} task  含 repeat
   * @param {string} fromISO 起始日期
   * @param {object} opts { horizonDays: 默认 90, maxCount: 默认 60 }
   */
  function expandRepeat(task, fromISO, opts) {
    opts = opts || {};
    if (!task || !task.repeat) return [];
    var horizon = opts.horizonDays || 90;
    var maxCount = opts.maxCount || 60;
    var start = fromISO || todayISO();
    var until = task.repeat.until || null;
    var out = [];
    for (var i = 0; i <= horizon && out.length < maxCount; i++) {
      var iso = addDaysISO(start, i);
      if (until && iso > until) break;
      if (hitsOn(task.repeat, iso)) out.push(iso);
    }
    return out;
  }

  /**
   * 把一条「重复任务模板」展开成多条独立任务（共享 seriesId）
   * 返回新任务数组；原模板本身不下发，避免重复。
   */
  function materializeRepeat(template, fromISO, opts) {
    opts = opts || {};
    if (!template || !template.repeat) return [];
    var dates = expandRepeat(template, fromISO, opts);
    if (!dates.length) return [];
    var seriesId = template.seriesId || template.id;
    return dates.map(function (iso) {
      return normalizeTask(Object.assign({}, template, {
        id: uid(),
        seriesId: seriesId,
        due: iso,
        done: false,
        doneAt: null,
        spent: 0,
        subtasks: (template.subtasks || []).map(function (s) {
          return Object.assign({}, s, { id: uid(), done: false, doneAt: null });
        })
      }));
    });
  }

  /* ------------------------------------------------------------------ *
   * 已完成任务的保留与清理
   * ------------------------------------------------------------------ */
  var DONE_KEEP_DAYS = 7;

  /** 该任务是否已超过保留期（应被清理） */
  function isExpiredDone(task, today) {
    if (!task || !task.done) return false;
    today = today || todayISO();
    var base = task.doneAt || task.createdAt;
    if (!base) return false;
    var diff = daysBetween(String(base).slice(0, 10), today);
    return diff > DONE_KEEP_DAYS;
  }

  /**
   * 清理过期已完成任务
   * @returns {{kept: Array, removed: Array}}
   */
  function pruneDoneTasks(tasks, today) {
    today = today || todayISO();
    var kept = [], removed = [];
    (tasks || []).forEach(function (t) {
      if (isExpiredDone(t, today)) removed.push(t);
      else kept.push(t);
    });
    return { kept: kept, removed: removed };
  }

  /** 还剩几天被清理（用于界面提示） */
  function daysUntilPrune(task, today) {
    if (!task || !task.done) return null;
    today = today || todayISO();
    var base = task.doneAt || task.createdAt;
    if (!base) return null;
    var used = daysBetween(String(base).slice(0, 10), today);
    return Math.max(0, DONE_KEEP_DAYS - used);
  }

  /* ------------------------------------------------------------------ *
   * 每日排程
   * ------------------------------------------------------------------ */
  /**
   * 每任务今日配额：越接近截止，今天需要投入越多
   *   quota = 剩余工时 / (剩余天数 + 1)，无期限任务只给一点点
   */
  function dailyQuota(task, today, settings) {
    var remain = remainingMinutes(task);
    if (remain <= 0) return 0;
    var minSlice = Math.max(5, (settings && settings.minSlice) || 15);
    var dl = daysLeft(task, today);
    if (dl === null) return Math.min(remain, 45);
    if (dl <= 0) return remain;                       // 逾期 / 今天到期：全排
    var q = Math.ceil(remain / (dl + 1) / 5) * 5;     // 按天摊，向上取到 5 分钟
    return clamp(Math.max(q, minSlice), minSlice, remain);
  }

  function collectChunks(tasks, today, settings, scoreISO, budgetMap) {
    settings = settings || DEFAULT_SETTINGS;
    scoreISO = scoreISO || today;
    var list = [];
    (tasks || []).forEach(function (t) {
      if (t.done) return;
      var remain = remainingMinutes(t);
      if (remain <= 0) return;
      var quota = dailyQuota(t, today, settings);
      if (budgetMap && typeof budgetMap[t.id] === 'number') {
        quota = Math.min(quota, Math.max(0, budgetMap[t.id]));
      }
      if (quota <= 0) return;
      var s = scoreOf(t, scoreISO);
      var chunks = [];
      var budget = quota;

      if (t.subtasks && t.subtasks.length) {
        t.subtasks.forEach(function (sub, i) {
          if (sub.done || budget <= 0) return;
          var take = Math.min(Math.max(0, sub.estimate || 0), budget);
          if (take <= 0) return;
          budget -= take;
          chunks.push({
            taskId: t.id, subId: sub.id,
            title: sub.title,
            parentTitle: t.title,
            estimate: Math.round(take),
            order: i
          });
        });
      }
      if (!chunks.length) {
        chunks.push({ taskId: t.id, subId: null, title: t.title, parentTitle: t.title, estimate: budget, order: 0 });
      }
      chunks.forEach(function (c) {
        c.score = s.score;
        c.due = t.due || null;
        c.difficulty = t.difficulty;
        c.importance = t.importance;
        c.reasons = s.reasons;
        c.quota = quota;
        list.push(c);
      });
    });
    list.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      var ad = a.due || '9999-99-99', bd = b.due || '9999-99-99';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return a.order - b.order;
    });
    return list;
  }

  function subtractRange(slots, a, b) {
    var out = [];
    slots.forEach(function (slot) {
      var s = slot[0], e = slot[1];
      if (b <= s || a >= e) { out.push([s, e]); return; }
      if (a > s) out.push([s, Math.min(a, e)]);
      if (b < e) out.push([Math.max(b, s), e]);
    });
    return out;
  }

  function freeSlots(dateISO, events, settings) {
    var start = minutesOf(settings.workStart);
    var end = minutesOf(settings.workEnd);
    if (end <= start) end = start + 60;
    var slots = [[start, end]];
    (events || []).forEach(function (ev) {
      if (ev.date !== dateISO) return;
      var a = minutesOf(ev.start), b = minutesOf(ev.end);
      if (b <= a) return;
      slots = subtractRange(slots, a, b);
    });
    return slots
      .map(function (s) { return [Math.max(start, s[0]), Math.min(end, s[1])]; })
      .filter(function (s) { return s[1] - s[0] >= 5; })
      .sort(function (a, b) { return a[0] - b[0]; });
  }

  function describeNow(min) { return clockOf(min); }

  /**
   * 生成某天的行程
   * 支持三类内容：
   *  1) 普通任务 —— 按优先级填进空闲时间
   *  2) 指定时间段的任务（fixedStart/fixedEnd）—— 锁定在用户给的时间窗内
   *  3) 固定安排（events）—— 不可移动，直接占位
   * @param {object} o { dateISO, tasks, events, settings, nowISO, nowMin }
   */
  function planDay(o) {
    o = o || {};
    var dateISO = o.dateISO || todayISO();
    var settings = Object.assign({}, DEFAULT_SETTINGS, o.settings || {});
    var nowISO = o.nowISO || todayISO();
    var events = o.events || [];
    var isToday = dateISO === nowISO;
    var allTasks = o.tasks || [];

    // 当天要出现的内容：
    //  - 重复任务：只在命中当天出现（不能提前做，否则每天都排，重复就失去意义）
    //  - 到期日为当天 / 已过期未完成 → 都要处理
    //  - 今天没到期、但还没做完 → 按配额提前推进（避免到期日才手忙脚乱）
    var dayTasks = allTasks.filter(function (t) {
      if (t.done) return false;
      if (t.repeat) return hitsOn(t.repeat, dateISO);   // 重复任务只看是否命中
      if (t.due === dateISO) return true;
      if (t.due && t.due < dateISO) return true;        // 已过期：仍需补做
      if (t.due && t.due > dateISO) return true;        // 未来任务：提前做一点
      if (!t.due) return true;                          // 无期限任务：按配额推进
      return false;
    });

    // 配额按「所规划的那一天」计算
    var chunks = collectChunks(dayTasks, dateISO, settings, nowISO, o.budget);
    var backlog = allTasks.filter(function (t) { return !t.done; })
      .reduce(function (a, t) { return a + remainingMinutes(t); }, 0);

    var slots = freeSlots(dateISO, events, settings);
    if (isToday && typeof o.nowMin === 'number') {
      slots = slots
        .map(function (s) { return [Math.max(s[0], o.nowMin), s[1]]; })
        .filter(function (s) { return s[1] - s[0] >= 5; });
    }

    // —— 第一步：把「指定时间段」的任务先锁定 ——
    var blocks = [];
    var seq = 0;
    var lockedBlocks = [];
    var remaining = {};
    var lockedTaskIds = {};      // 已经有固定时段的任务，不能再被当普通任务重排

    chunks.forEach(function (c) {
      remaining[c.taskId + '|' + (c.subId || '')] = c.estimate;
    });

    dayTasks.forEach(function (t) {
      if (!t.fixedStart || !t.fixedEnd) return;
      var a = minutesOf(t.fixedStart);
      var b = minutesOf(t.fixedEnd);
      if (b <= a) return;

      // 有固定时段的任务，一律不参与自由排程：
      //  - 时段还没到 → 锁定排入
      //  - 时段已过   → 今天跳过（不挪到别的时间，尊重用户指定）
      lockedTaskIds[t.id] = true;

      if (isToday && typeof o.nowMin === 'number' && b <= o.nowMin) return;  // 已过，跳过

      lockedBlocks.push({
        id: dateISO + '-' + seq++,
        date: dateISO,
        start: clockOf(a),
        end: clockOf(b),
        startMin: a,
        endMin: b,
        minutes: b - a,
        taskId: t.id,
        subId: null,
        title: t.title,
        parentTitle: t.title,
        score: t.isEvent ? 0 : scoreOf(t, nowISO).score,
        due: t.due || null,
        kind: t.isEvent ? 'event' : 'work',
        locked: true,
        isEvent: !!t.isEvent
      });
      remaining[t.id + '|'] = 0;   // 该任务今天已占用整段时间
    });

    // 锁定块占掉的时间从空闲里扣除（含固定安排）
    lockedBlocks.forEach(function (lb) {
      slots = subtractRange(slots, lb.startMin, lb.endMin);
    });

    // 每个锁定块后面留一段休息，避免紧接着排任务
    var restLen = Math.max(0, settings.breakLen || 0);

    var minSlice = Math.max(5, settings.minSlice || 15);
    var focusMax = Math.max(15, settings.focusMax || 45);
    var breakLen = Math.max(0, settings.breakLen || 0);

    // —— 第二步：普通任务填进剩余空闲 ——
    slots.forEach(function (slot) {
      var cursor = slot[0];
      while (cursor < slot[1]) {
        var avail = slot[1] - cursor;
        if (avail < minSlice) break;

        var pick = null;
        for (var i = 0; i < chunks.length; i++) {
          var c = chunks[i];
          if (lockedTaskIds[c.taskId]) continue;   // 有固定时段的任务不参与自由排程
          var key = c.taskId + '|' + (c.subId || '');
          if ((remaining[key] || 0) <= 0) continue;
          pick = c;
          break;
        }
        if (!pick) break;

        var key2 = pick.taskId + '|' + (pick.subId || '');
        var want = Math.min(remaining[key2], focusMax, avail);
        if (want < minSlice && remaining[key2] > minSlice) break;

        var startMin = cursor;
        var endMin = cursor + want;
        blocks.push({
          id: dateISO + '-' + seq++,
          date: dateISO,
          start: clockOf(startMin),
          end: clockOf(endMin),
          startMin: startMin,
          endMin: endMin,
          minutes: want,
          taskId: pick.taskId,
          subId: pick.subId,
          title: pick.title,
          parentTitle: pick.parentTitle,
          score: pick.score,
          due: pick.due,
          reasons: pick.reasons,
          kind: 'work'
        });
        remaining[key2] -= want;

        cursor = endMin;
        var hasMore = chunks.some(function (c) {
          return (remaining[c.taskId + '|' + (c.subId || '')] || 0) > 0;
        });
        if (breakLen > 0 && hasMore && cursor + breakLen < slot[1] - minSlice) {
          blocks.push({
            id: dateISO + '-' + seq++,
            date: dateISO,
            start: clockOf(cursor),
            end: clockOf(cursor + breakLen),
            startMin: cursor,
            endMin: cursor + breakLen,
            minutes: breakLen,
            kind: 'break',
            title: '休息一下'
          });
          cursor += breakLen;
        }
      }
    });

    // 合并锁定块，按时间排序
    blocks = blocks.concat(lockedBlocks).sort(function (a, b) {
      if (a.startMin !== b.startMin) return a.startMin - b.startMin;
      return a.kind === 'break' ? 1 : -1;
    });

    var scheduled = blocks.filter(function (b) { return b.kind === 'work'; })
      .reduce(function (a, b) { return a + b.minutes; }, 0);
    var needTotal = chunks.reduce(function (a, c) { return a + c.estimate; }, 0);
    var unscheduled = [];
    var seenTask = {};
    chunks.forEach(function (c) {
      if (lockedTaskIds[c.taskId]) return;   // 已有固定时段，不计入"排不下"
      var left = remaining[c.taskId + '|' + (c.subId || '')] || 0;
      if (left > 0) {
        var item = seenTask[c.taskId];
        if (!item) {
          item = { taskId: c.taskId, title: c.parentTitle, minutes: 0 };
          seenTask[c.taskId] = item;
          unscheduled.push(item);
        }
        item.minutes += left;
      }
    });

    var freeMinutes = slots.reduce(function (a, s) { return a + (s[1] - s[0]); }, 0);
    var capacity = slots.reduce(function (a, s) {
      return a + Math.max(0, s[1] - s[0] - Math.ceil((s[1] - s[0]) / (focusMax + breakLen)) * breakLen);
    }, 0);

    var warnings = [];
    var overdue = (o.tasks || []).filter(function (t) { return !t.done && statusOf(t, nowISO) === 'overdue'; });
    if (overdue.length) warnings.push('有 ' + overdue.length + ' 个任务已过截止时间，先处理它们或重新设定日期。');
    if (unscheduled.length) {
      warnings.push('今天排不下 ' + fmtDuration(unscheduled.reduce(function (a, u) { return a + u.minutes; }, 0)) +
        '的计划量，可以留到明后天。');
    }
    if (capacity > 0 && scheduled >= capacity * 0.92) {
      warnings.push('今天几乎排满了，记得给临时事项留点缓冲。');
    }

    return {
      date: dateISO,
      blocks: blocks,
      unscheduled: unscheduled,
      warnings: warnings,
      stats: {
        needTotal: needTotal,
        backlog: backlog,
        scheduled: scheduled,
        remaining: Math.max(0, needTotal - scheduled),
        freeMinutes: freeMinutes,
        capacity: Math.max(0, capacity),
        focusMax: focusMax,
        breakLen: breakLen,
        workStart: settings.workStart,
        workEnd: settings.workEnd
      }
    };
  }

  function nextBlock(blocks, nowMin) {
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].kind === 'work' && blocks[i].endMin > nowMin) return blocks[i];
    }
    return null;
  }

  /**
   * 连续多天的排程：每天按配额安排，再把已排的量从剩余预算里扣掉，
   * 避免「未来 7 天」里同一件任务被重复排满。
   */
  function planRange(o) {
    o = o || {};
    var startISO = o.startISO || todayISO();
    var days = Math.max(1, o.days || 7);
    var nowISO = o.nowISO || todayISO();
    var settings = Object.assign({}, DEFAULT_SETTINGS, o.settings || {});
    var budget = {};
    (o.tasks || []).forEach(function (t) {
      if (!t.done) budget[t.id] = remainingMinutes(t);
    });

    var out = [];
    for (var i = 0; i < days; i++) {
      var iso = addDaysISO(startISO, i);
      var plan = planDay({
        dateISO: iso,
        tasks: o.tasks || [],
        events: o.events || [],
        settings: settings,
        nowISO: nowISO,
        // 只有「今天」才需要跳过已经过去的时间；
        // 允许调用方覆盖，便于测试与导出得到稳定结果
        nowMin: (i === 0 && iso === nowISO)
          ? (typeof o.nowMin === 'number' ? o.nowMin : currentMin())
          : null,
        budget: budget
      });
      plan.blocks.forEach(function (b) {
        if (b.kind !== 'work') return;
        if (typeof budget[b.taskId] === 'number') {
          budget[b.taskId] = Math.max(0, budget[b.taskId] - b.minutes);
        }
      });
      plan.allocated = plan.stats.scheduled;
      out.push(plan);
    }
    return out;
  }

  function currentMin() {
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  /* ------------------------------------------------------------------ *
   * 中文自然语言解析
   * ------------------------------------------------------------------ */
  var CN_DIGITS = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };

  function cnToInt(str) {
    if (!str) return NaN;
    if (/^\d+$/.test(str)) return parseInt(str, 10);
    if (CN_DIGITS[str] !== undefined) return CN_DIGITS[str];
    var m = str.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/);
    if (m) {
      var tens = m[1] ? CN_DIGITS[m[1]] : 1;
      var ones = m[2] ? CN_DIGITS[m[2]] : 0;
      return tens * 10 + ones;
    }
    return NaN;
  }

  function guessDifficulty(text) {
    var s = String(text);
    if (/超难|极难|最难|非常难|特别难|烧脑/.test(s)) return 5;
    if (/很难|挺难|困难|难点|不易|hard/i.test(s)) return 4;
    if (/有点难|稍微难|中上/.test(s)) return 4;
    if (/简单|容易|轻松|easy|很快/.test(s)) return 2;
    if (/中等|一般|正常/.test(s)) return 3;
    return null;
  }

  function guessImportance(text) {
    var s = String(text);
    if (/最重要|极重要|关键|必须|一定要|务必|紧急|急|马上|立刻|火烧眉毛/.test(s)) return 5;
    if (/重要|要紧|重视/.test(s)) return 4;
    if (/不急|随便|不当紧|可有可无|无所谓|顺便|空的时候|有时间再|不着急/.test(s)) return 2;
    if (/随便|顺便/.test(s)) return 2;
    return null;
  }

  function guessEstimate(title, difficulty) {
    var s = String(title);
    var rules = [
      [/论文|毕设|毕业设计|综述/, 480],
      [/复习|备考|考试|刷题/, 300],
      [/报告|汇报|ppt|演示|课件|方案/, 180],
      [/开发|编程|项目|小程序|网站|系统/, 360],
      [/设计|海报|封面|作品集/, 180],
      [/演讲|答辩|路演/, 180],
      [/读书|看完|学习|自学|课程|网课|教程|入门/, 240],
      [/简历|求职|面试/, 120],
      [/作业|习题|练习/, 90],
      [/整理|打扫|清洁|收拾/, 60],
      [/买|采购|跑腿|取|寄/, 30],
      [/回复|回信|消息|邮件/, 15]
    ];
    for (var i = 0; i < rules.length; i++) if (rules[i][0].test(s)) return rules[i][1];
    return (difficulty || 3) * 30;
  }

  function matchDate(text, today) {
    var t = parseISO(today);
    var year = t.getFullYear(), month = t.getMonth(), day = t.getDate();
    var m;

    // 2026-11-20 / 2026年11月20日
    m = text.match(/(\d{4})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})\s*[日号]?/);
    if (m) {
      return { iso: m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]), matched: m[0] };
    }
    // 11月20日 / 11.20 / 11/20
    m = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
    if (m) {
      return { iso: year + '-' + pad2(+m[1]) + '-' + pad2(+m[2]), matched: m[0] };
    }
    m = text.match(/(?<!\d)(\d{1,2})[.\/](\d{1,2})(?!\d)/);
    if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) {
      return { iso: year + '-' + pad2(+m[1]) + '-' + pad2(+m[2]), matched: m[0] };
    }
    // 下个月X号
    m = text.match(/下个?月\s*(\d{1,2})\s*[日号]?/);
    if (m) {
      var d1 = new Date(year, month + 1, +m[1]);
      return { iso: toISO(d1), matched: m[0] };
    }
    // 本月X号
    m = text.match(/(?:这个?月|本月)\s*(\d{1,2})\s*[日号]?/);
    if (m) {
      return { iso: year + '-' + pad2(month + 1) + '-' + pad2(+m[1]), matched: m[0] };
    }
    // 相对天数
    var rel = [
      [/大后天/, 3], [/后天/, 2], [/明天|明日/, 1], [/今天|今日/, 0]
    ];
    for (var i = 0; i < rel.length; i++) {
      if (rel[i][0].test(text)) return { iso: addDaysISO(today, rel[i][1]), matched: text.match(rel[i][0])[0] };
    }
    // X天后 / X天之后
    m = text.match(/([0-9]+|[一二两三四五六七八九十]+)\s*天\s*(?:之?后|以后)/);
    if (m) {
      var n = cnToInt(m[1]);
      if (!isNaN(n)) return { iso: addDaysISO(today, n), matched: m[0] };
    }
    // 一周后 / 下周 / 半个月后 / 下个月
    if (/半个月后/.test(text)) return { iso: addDaysISO(today, 15), matched: '半个月后' };
    if (/下个?月(?!\s*\d)/.test(text)) return { iso: addDaysISO(today, 30), matched: '下个月' };
    if (/下个?周|下周/.test(text)) {
      var wm = text.match(/(?:下个?周|下周)\s*([一二三四五六日天])/);
      if (wm) {
        var target = '日一二三四五六'.indexOf(wm[1] === '天' ? '日' : wm[1]);
        var delta = ((target - t.getDay() + 7) % 7) + 7;
        return { iso: addDaysISO(today, delta), matched: wm[0] };
      }
      return { iso: addDaysISO(today, 7), matched: '下周' };
    }
    // 周X / 星期X / 礼拜X
    m = text.match(/(?:这|本)?(?:周|星期|礼拜)([一二三四五六日天])/);
    if (m) {
      var target2 = '日一二三四五六'.indexOf(m[1] === '天' ? '日' : m[1]);
      var delta2 = (target2 - t.getDay() + 7) % 7;
      return { iso: addDaysISO(today, delta2), matched: m[0] };
    }
    // 周末 / 月底 / 下月
    if (/周末/.test(text)) {
      var delta3 = (6 - t.getDay() + 7) % 7;
      return { iso: addDaysISO(today, delta3), matched: '周末' };
    }
    if (/月底/.test(text)) {
      var last = daysInMonth(year, month);
      return { iso: year + '-' + pad2(month + 1) + '-' + pad2(last), matched: '月底' };
    }
    // 单纯 X号
    m = text.match(/(?:^|[^\d])(\d{1,2})\s*[日号]/);
    if (m) {
      var dd = +m[1];
      if (dd >= 1 && dd <= 31) {
        var cand = new Date(year, month, dd);
        if (dd < day) cand = new Date(year, month + 1, dd);
        return { iso: toISO(cand), matched: m[0] };
      }
    }
    return null;
  }

  function matchTime(text) {
    var m = text.match(/(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|今晚)?\s*(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*[点:：]\s*(\d{1,2})?\s*分?/);
    if (!m) {
      var m2 = text.match(/(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|今晚)?\s*(\d{1,2})\s*(?=[前后])/);
      if (!m2) return null;
      m = m2;
    }
    var hour = cnToInt(m[2]);
    if (isNaN(hour) || hour > 24) return null;
    var minute = m[3] ? parseInt(m[3], 10) : 0;
    if (minute > 59) minute = 0;
    var period = m[1] || '';
    if (/下午|傍晚|晚上|夜里|今晚/.test(period) && hour < 12) hour += 12;
    else if (period === '中午' && hour < 11) hour += 12;
    else if (/凌晨/.test(period) && hour === 12) hour = 0;
    else if (hour < 7 && !period) hour += 12; // 3点 → 15:00
    if (hour >= 24) hour = hour % 24;
    return {
      time: pad2(hour) + ':' + pad2(minute),
      matched: m[0]
    };
  }

  function matchDuration(text) {
    var total = 0, matched = '';
    var h = text.match(/(\d+(?:\.\d+)?|[一二两三四五六七八九十半]+)\s*个?\s*(?:小时|钟头|h|hr)/i);
    if (h) {
      matched += h[0];
      if (/半/.test(h[1]) && !/\d/.test(h[1])) total += 30;
      else {
        var hv = parseFloat(h[1]);
        if (isNaN(hv)) hv = cnToInt(h[1]);
        if (!isNaN(hv)) total += hv * 60;
      }
    }
    var m = text.match(/(\d+|[一二两三四五六七八九十]+)\s*(?:分钟|分|min|mins)/i);
    if (m) {
      matched += m[0];
      var mv = cnToInt(m[1]);
      if (!isNaN(mv)) total += mv;
    }
    if (/半小时/.test(text)) { matched += '半小时'; total += 30; }
    if (/一个?半小时/.test(text)) total = Math.max(total, 90);
    return total > 0 ? { minutes: Math.round(total), matched: matched } : null;
  }

  function cleanTitle(text, spans) {
    var s = String(text);
    spans.forEach(function (sp) {
      if (!sp) return;
      s = s.split(sp).join(' ');
    });
    s = s.replace(/[，。！？、,.!?;；:：]+/g, ' ');
    s = s.replace(/(?:截止|ddl|DDL|deadline|提醒我|帮我|记得|安排)/g, ' ');
    // 被移除的时间/日期 span 后面常跟一个“前”字，单独清掉
    s = s.replace(/(^|\s)(?:之前|以前|前)(?=\S)/g, '$1');
    s = s.replace(/(?:^|\s)(?:之前|以前|前)(\s|$)/g, ' ');
    s = s.replace(/^\s*(?:要|需要|我要|我想|得)\s*/, '');
    s = s.replace(/(?:要|需要)\s*$/g, '');
    s = s.replace(/^(?:一下|顺便)\s*/, '');
    s = s.replace(/(?:随便|有空|顺手|记得|别忘)\s*/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length > 40) s = s.slice(0, 40);
    return s || '新任务';
  }

  /**
   * 解析重复规则
   * 支持：每周一 / 每星期一 / 每周一和周四 / 每天 / 每日 / 每个工作日 / 每月15号
   * 返回 { repeat, matched }，matched 是应当从标题里移除的原文
   */
  var CN_WEEK = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0, '七': 0 };

  function parseCnWeekList(str) {
    var out = [];
    var re = /([一二三四五六日天七])/g;
    var m;
    while ((m = re.exec(str))) {
      var v = CN_WEEK[m[1]];
      if (v !== undefined && out.indexOf(v) === -1) out.push(v);
    }
    return out;
  }

  function matchRepeat(text) {
    var s = String(text || '');

    // 每天 / 每日 / 天天
    var m = s.match(/每\s*[天日]|天天/);
    if (m) {
      return { repeat: { freq: 'daily' }, matched: m[0] };
    }

    // 每个工作日 / 每工作日 / 周一到周五
    m = s.match(/每\s*个?\s*工作日|周一至周五|周一到周五/);
    if (m) {
      return { repeat: { freq: 'weekday' }, matched: m[0] };
    }

    // 每周X / 每星期X / 每礼拜X，可带多个：每周一和周四、每周一、三、五
    m = s.match(/每\s*(?:周|星期|礼拜)\s*([一二三四五六日天七周星期礼拜号、,，和与及/\s]*)/);
    if (m) {
      var body = m[1] || '';
      var days = parseCnWeekList(body);
      if (days.length) {
        return {
          repeat: { freq: 'weekly', weekday: days[0], weekdays: days },
          matched: m[0].replace(/\s+$/, '')
        };
      }
      // “每周”单说 → 取截止日/今天的星期
      return { repeat: { freq: 'weekly', weekday: null, weekdays: null }, matched: m[0].replace(/\s+$/, '') };
    }

    // 每月X号 / 每月X日
    m = s.match(/每\s*个?\s*月\s*(\d{1,2}|[一二三四五六七八九十]+)\s*[号日]?/);
    if (m) {
      var d = cnToInt(m[1]);
      if (!isNaN(d) && d >= 1 && d <= 31) {
        return { repeat: { freq: 'monthly', monthDay: d }, matched: m[0] };
      }
    }

    return null;
  }

  /**
   * 解析一句自然语言任务
   * 例：明天下午3点前交高数作业，预计2小时，很难
   */
  function parseInput(text, today) {
    today = today || todayISO();
    var raw = String(text || '').trim();
    var spans = [];

    // 先解析重复规则（必须在日期之前，否则“每周一”里的“周一”会被当成日期吃掉）
    var repeatHit = matchRepeat(raw);
    var repeatText = repeatHit ? repeatHit.matched : '';

    // 移除重复表达后再解析日期/时间，避免冲突
    var rest = repeatText ? raw.split(repeatText).join(' ') : raw;

    var dateHit = matchDate(rest, today);
    var timeHit = matchTime(rest);
    // 时长从“去掉时间点”的文本里找，避免把 “3点30分” 的 30分 当成时长
    var durHit = matchDuration(timeHit ? rest.replace(timeHit.matched, ' ') : rest);
    var diff = guessDifficulty(raw);
    var imp = guessImportance(raw);

    if (repeatText) spans.push(repeatText);
    if (dateHit) spans.push(dateHit.matched);
    if (timeHit) spans.push(timeHit.matched);
    if (durHit) spans.push(durHit.matched);
    // 移除描述性词语
    var descRe = /(超难|极难|最难|非常难|特别难|烧脑|很难|挺难|困难|难点|不易|有点难|稍微难|中上|简单|容易|轻松|很快|最重要|极重要|关键|必须|一定要|务必|紧急|马上|立刻|不急|随便|有时间|顺便|重要|要紧|重视|中等|一般|正常|预计|大约|大概|左右)/g;
    var dm;
    while ((dm = descRe.exec(raw))) spans.push(dm[0]);

    var title = cleanTitle(raw, spans);
    var due = dateHit ? dateHit.iso : null;

    // 重复规则：每周没指定星期时，用截止日（或今天）的星期补上
    var repeat = null;
    if (repeatHit) {
      repeat = Object.assign({}, repeatHit.repeat);
      if (repeat.freq === 'weekly' && (repeat.weekday === null || repeat.weekday === undefined)) {
        repeat.weekday = parseISO(due || today).getDay();
        repeat.weekdays = [repeat.weekday];
      }
      if (repeat.freq === 'weekly' && !repeat.weekdays) {
        repeat.weekdays = [repeat.weekday];
      }
    }
    // 有重复规则时，默认从今天开始系列
    if (repeat && !due) due = today;
    if (!due && timeHit) due = today;

    return {
      title: title,
      due: due,
      dueTime: timeHit ? timeHit.time : null,
      estimate: durHit ? durHit.minutes : guessEstimate(title, diff),
      difficulty: diff || 3,
      importance: imp || 3,
      repeat: repeat,
      parsed: {
        date: !!dateHit,
        time: !!timeHit,
        duration: !!durHit,
        difficulty: diff !== null,
        importance: imp !== null,
        repeat: !!repeat
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * ICS 日历导出
   * ------------------------------------------------------------------ */
  function icsEscape(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  function icsDate(iso) { return String(iso).replace(/-/g, ''); }
  function icsDateTime(iso, hhmm) {
    return icsDate(iso) + 'T' + String(hhmm || '09:00').replace(':', '') + '00';
  }
  function utcStamp(d) {
    d = d || new Date();
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
      'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
  }

  function foldLine(line) {
    if (line.length <= 74) return line;
    var out = [line.slice(0, 74)];
    var rest = line.slice(74);
    while (rest.length > 0) {
      out.push(' ' + rest.slice(0, 73));
      rest = rest.slice(73);
    }
    return out.join('\r\n');
  }

  function buildICS(o) {
    o = o || {};
    var tasks = o.tasks || [];
    var blocks = o.blocks || [];
    var events = o.events || [];
    var now = utcStamp(o.now);
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//DDL Planner//CN',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:' + icsEscape('DDL 计划表'),
      'X-WR-TIMEZONE:Asia/Shanghai'
    ];
    function push(uidStr, dateISO, start, end, summary, desc, allDay) {
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + icsEscape(uidStr) + '@ddl-planner');
      lines.push('DTSTAMP:' + now);
      if (allDay) {
        lines.push('DTSTART;VALUE=DATE:' + icsDate(dateISO));
        lines.push('DTEND;VALUE=DATE:' + icsDate(addDaysISO(dateISO, 1)));
      } else {
        lines.push('DTSTART:' + icsDateTime(dateISO, start));
        lines.push('DTEND:' + icsDateTime(dateISO, end));
      }
      lines.push('SUMMARY:' + icsEscape(summary));
      if (desc) lines.push('DESCRIPTION:' + icsEscape(desc));
      lines.push('END:VEVENT');
    }
    tasks.forEach(function (t) {
      if (t.done || !t.due) return;
      push('task-' + t.id, t.due, '23:00', '23:30',
        '⏰ 截止：' + t.title,
        '难度 ' + t.difficulty + ' · 重要度 ' + t.importance + ' · 预计 ' + fmtDuration(totalEstimate(t)), true);
    });
    blocks.forEach(function (b) {
      if (b.kind !== 'work') return;
      push('block-' + b.id, b.date, b.start, b.end, b.title,
        '来自 DDL 计划表 · 优先级 ' + b.score + ' 分');
    });
    events.forEach(function (ev) {
      if (!ev.date) return;
      push('event-' + ev.id, ev.date, ev.start || '09:00', ev.end || '10:00', ev.title || '固定安排', '');
    });
    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }

  /* ------------------------------------------------------------------ */
  return {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    WEEKDAYS: WEEKDAYS,
    PHASES: PHASES,
    uid: uid,
    clamp: clamp,
    pad2: pad2,
    toISO: toISO,
    todayISO: todayISO,
    parseISO: parseISO,
    addDaysISO: addDaysISO,
    daysBetween: daysBetween,
    weekdayOf: weekdayOf,
    daysInMonth: daysInMonth,
    minutesOf: minutesOf,
    clockOf: clockOf,
    currentMin: currentMin,
    fmtDuration: fmtDuration,
    fmtHours: fmtHours,
    shortTitle: shortTitle,
    normalizeTask: normalizeTask,
    remainingMinutes: remainingMinutes,
    totalEstimate: totalEstimate,
    progressOf: progressOf,
    daysLeft: daysLeft,
    statusOf: statusOf,
    dueLabel: dueLabel,
    scoreOf: scoreOf,
    sortTasks: sortTasks,
    REPEAT_LABELS: REPEAT_LABELS,
    repeatLabel: repeatLabel,
    hitsOn: hitsOn,
    expandRepeat: expandRepeat,
    materializeRepeat: materializeRepeat,
    detectDomain: detectDomain,
    breakdown: breakdown,
    DONE_KEEP_DAYS: DONE_KEEP_DAYS,
    isExpiredDone: isExpiredDone,
    pruneDoneTasks: pruneDoneTasks,
    daysUntilPrune: daysUntilPrune,
    dailyQuota: dailyQuota,
    collectChunks: collectChunks,
    freeSlots: freeSlots,
    planDay: planDay,
    planRange: planRange,
    nextBlock: nextBlock,
    parseInput: parseInput,
    guessEstimate: guessEstimate,
    buildICS: buildICS,
    icsEscape: icsEscape
  };
});
