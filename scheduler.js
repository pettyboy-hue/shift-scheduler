/**
 * 排班核心算法 v3 - 固定班次 + 智能调休
 * 
 * 核心思路：
 * 1. 每个员工有固定班次（早/中/晚），不会改变
 * 2. 算法只决定每天谁上班、谁休息
 * 3. 晚班4人轮换：每天排2人，保证公平
 * 4. 白班工作日1人固定上，周末视业务可0人
 * 5. 中班工作日2人，周末1人
 * 6. 支持调休假、请假等特殊情况
 */

var ShiftScheduler = (function() {

    // 班次配置：工时、工作日人数、周末人数
    var SHIFT_CONFIG = {
        morning: { hours: 9, label: '早班', time: '09:00-18:00', weekdayCount: 1, weekendCount: 1, lightWeekendCount: 0 },
        middle:  { hours: 9, label: '中班', time: '16:00-01:00', weekdayCount: 2, weekendCount: 1, lightWeekendCount: 1 },
        night:   { hours: 8, label: '晚班', time: '21:00-05:00', weekdayCount: 2, weekendCount: 1, lightWeekendCount: 1 }
    };

    var DAY_NAMES = ['日','一','二','三','四','五','六'];

    function Scheduler(config) {
        // employees: [{ name, shift }] — shift 是固定班次
        this.employees = config.employees || [];
        this.weekStart = config.weekStart; // 'YYYY-MM-DD' 周一日期
        this.weekType = config.weekType || 'big'; // 'big'=双休 'small'=单休
        this.busyness = config.busyness || 'normal'; // 'light'/'normal'/'busy'
        // specials: { name: { type: 'leave'|'dayoff', days: ['YYYY-MM-DD',...] } }
        this.specials = config.specials || {};
        // 历史数据：用于跨周公平性，{ name: { weekendDuty: N, totalWork: N, totalRest: N } }
        this.history = config.history || {};

        this.schedule = {}; // dateStr -> { morning: [], middle: [], night: [], rest: [] }
        this.dates = [];
        this.dateMeta = {};
    }

    // 生成一周排班（周一到周日，7天）
    Scheduler.prototype.generate = function() {
        this._buildDates();
        this._assignShifts();
        return {
            schedule: this.schedule,
            dates: this.dates,
            dateMeta: this.dateMeta,
            analysis: this._analyze()
        };
    };

    // 构建7天日期元数据
    Scheduler.prototype._buildDates = function() {
        var start = new Date(this.weekStart + 'T00:00:00');
        // 确保从周一开始
        for (var i = 0; i < 7; i++) {
            var d = new Date(start);
            d.setDate(d.getDate() + i);
            var dateStr = _formatDate(d);
            var dow = d.getDay(); // 0=周日
            var isWeekend = dow === 0 || dow === 6;

            // 判断这天是否休息日
            var isRestDay = false;
            if (this.weekType === 'big') {
                // 大休周：周六+周日都是休息日
                isRestDay = isWeekend;
            } else {
                // 小休周：仅周日
                isRestDay = dow === 0;
            }

            this.dates.push(dateStr);
            this.dateMeta[dateStr] = {
                date: dateStr,
                dayOfWeek: dow,
                dayName: DAY_NAMES[dow],
                isWeekend: isWeekend,
                isRestDay: isRestDay,
                dayIndex: i
            };
        }
    };

    // 核心排班逻辑
    Scheduler.prototype._assignShifts = function() {
        var self = this;
        
        // 按班次分组
        var groups = { morning: [], middle: [], night: [] };
        this.employees.forEach(function(emp) {
            if (groups[emp.shift]) {
                groups[emp.shift].push(emp.name);
            }
        });

        // 每天逐日排
        this.dates.forEach(function(dateStr) {
            var meta = self.dateMeta[dateStr];
            var daySchedule = { morning: [], middle: [], night: [], rest: [] };

            // 对每个班次，决定今天需要几人、排谁
            ['morning', 'middle', 'night'].forEach(function(shift) {
                var conf = SHIFT_CONFIG[shift];
                var pool = groups[shift].slice(); // 候选人

                // 排除今天请假/调休的人
                pool = pool.filter(function(name) {
                    var sp = self.specials[name];
                    if (!sp) return true;
                    if (sp.days && sp.days.indexOf(dateStr) >= 0) return false;
                    return true;
                });

                // 确定今天需要几人
                var needed;
                if (meta.isRestDay) {
                    // 休息日减半
                    if (self.busyness === 'light' && shift === 'morning') {
                        // 宽松时白班周末不排人
                        needed = 0;
                    } else if (self.busyness === 'busy') {
                        // 繁忙时周末不减人
                        needed = conf.weekdayCount;
                    } else {
                        needed = conf.weekendCount;
                    }
                } else if (meta.isWeekend && !meta.isRestDay) {
                    // 小休周的周六：属于工作日但是周末，可以适当减
                    if (self.busyness === 'light' && shift === 'morning') {
                        needed = 0;
                    } else {
                        needed = conf.weekendCount;
                    }
                } else {
                    // 工作日
                    needed = conf.weekdayCount;
                }

                // needed 不能超过可用人数
                needed = Math.min(needed, pool.length);

                // 选人：基于公平性评分
                var selected = self._selectWorkers(pool, needed, shift, dateStr, meta);
                daySchedule[shift] = selected;
            });

            // 没排到班的人今天休息
            var allWorking = {};
            ['morning', 'middle', 'night'].forEach(function(s) {
                daySchedule[s].forEach(function(n) { allWorking[n] = true; });
            });
            self.employees.forEach(function(emp) {
                if (!allWorking[emp.name]) {
                    daySchedule.rest.push(emp.name);
                }
            });

            self.schedule[dateStr] = daySchedule;
        });
    };

    /**
     * 从候选人中选出 count 人上班
     * 
     * 评分越低越优先上班（让分数高的人多休息）
     * - 历史工作天数多 → 分高（让他休息）
     * - 本周已连续工作天数多 → 分高
     * - 历史周末值班多 → 分高（如果今天是周末）
     * - 请假/调休 → 已排除
     */
    Scheduler.prototype._selectWorkers = function(pool, count, shift, dateStr, meta) {
        if (count === 0 || pool.length === 0) return [];
        var self = this;

        var scored = pool.map(function(name) {
            var score = 0;
            var hist = self.history[name] || { totalWork: 0, weekendDuty: 0, totalRest: 0 };

            // 本周已连续工作了几天——从前面的天数倒查
            var consecutiveWork = 0;
            for (var i = self.dates.indexOf(dateStr) - 1; i >= 0; i--) {
                var prevDate = self.dates[i];
                var prevSched = self.schedule[prevDate];
                if (prevSched && prevSched.rest.indexOf(name) >= 0) break;
                consecutiveWork++;
            }

            // 连续工作越多，越不想让他继续上（加分=靠后）
            if (consecutiveWork >= 5) score += 500;
            else if (consecutiveWork >= 4) score += 200;
            else score += consecutiveWork * 20;

            // 历史总工作天数越多，分越高（平衡）
            score += (hist.totalWork || 0) * 5;

            // 如果是周末，历史周末值班多的人分高
            if (meta.isWeekend) {
                score += (hist.weekendDuty || 0) * 30;
            }

            // 微量随机扰动
            score += Math.random() * 5;

            return { name: name, score: score };
        });

        // 分数低的优先上班
        scored.sort(function(a, b) { return a.score - b.score; });
        return scored.slice(0, count).map(function(s) { return s.name; });
    };

    // 本周排班分析
    Scheduler.prototype._analyze = function() {
        var self = this;
        var result = {
            perPerson: {},
            warnings: [],
            suggestions: [],
            summary: {}
        };

        this.employees.forEach(function(emp) {
            var name = emp.name;
            var data = {
                name: name,
                fixedShift: emp.shift,
                fixedShiftLabel: SHIFT_CONFIG[emp.shift].label,
                fixedShiftTime: SHIFT_CONFIG[emp.shift].time,
                workDays: [],
                restDays: [],
                weekendDutyDays: [],
                isDoubleRest: false,    // 本周是否连休两天
                isSingleRest: false,
                isNoRest: false,
                restType: '',
                restLabel: '',
                consecutiveWork: 0,     // 本周最长连续工作
                totalHours: 0,
                issues: [],
                special: self.specials[name] || null
            };

            var consecutive = 0;
            var maxConsec = 0;

            self.dates.forEach(function(dateStr) {
                var daySched = self.schedule[dateStr];
                var meta = self.dateMeta[dateStr];
                var isResting = daySched.rest.indexOf(name) >= 0;

                if (isResting) {
                    data.restDays.push(dateStr);
                    if (consecutive > maxConsec) maxConsec = consecutive;
                    consecutive = 0;
                } else {
                    data.workDays.push(dateStr);
                    consecutive++;
                    if (meta.isWeekend) {
                        data.weekendDutyDays.push(dateStr);
                    }
                }
            });
            if (consecutive > maxConsec) maxConsec = consecutive;
            data.consecutiveWork = maxConsec;
            data.totalHours = data.workDays.length * SHIFT_CONFIG[emp.shift].hours;

            // 分析休息类型
            var restCount = data.restDays.length;
            if (restCount === 0) {
                data.isNoRest = true;
                data.restType = 'none';
                data.restLabel = '❌ 无休';
                data.issues.push({ level: 'danger', text: '本周没有任何休息日！' });
                result.warnings.push('🔴 ' + name + ' 本周没有休息日，请务必调整');
            } else if (restCount === 1) {
                data.isSingleRest = true;
                data.restType = 'single';
                data.restLabel = '🟡 单休';
            } else {
                // 检查是否连休
                var sortedRest = data.restDays.slice().sort();
                var isConsec = true;
                for (var i = 1; i < sortedRest.length; i++) {
                    var diff = (new Date(sortedRest[i]) - new Date(sortedRest[i-1])) / 86400000;
                    if (diff > 1) { isConsec = false; break; }
                }
                if (restCount >= 2 && isConsec) {
                    data.isDoubleRest = true;
                    data.restType = 'double';
                    data.restLabel = '🟢 连休' + restCount + '天';
                } else {
                    data.restType = 'split';
                    data.restLabel = '🟠 拆休' + restCount + '天';
                    data.issues.push({ level: 'warning', text: '休息日不连续，建议调整为连休' });
                }
            }

            // 连续工作过长预警
            if (data.consecutiveWork >= 6) {
                data.issues.push({ level: 'danger', text: '连续工作' + data.consecutiveWork + '天，严重疲劳' });
                result.warnings.push('🔴 ' + name + ' 连续工作' + data.consecutiveWork + '天');
            } else if (data.consecutiveWork >= 5) {
                data.issues.push({ level: 'warning', text: '连续工作' + data.consecutiveWork + '天，较为辛苦' });
            }

            // 特殊情况标记
            if (data.special) {
                var sp = data.special;
                if (sp.type === 'dayoff') {
                    data.issues.push({ level: 'info', text: '本周使用调休假 ' + sp.days.length + ' 天' });
                } else if (sp.type === 'leave') {
                    data.issues.push({ level: 'info', text: '本周请假 ' + sp.days.length + ' 天' });
                }
            }

            result.perPerson[name] = data;
        });

        // 全局建议
        var noRestPeople = [];
        var splitRestPeople = [];
        self.employees.forEach(function(emp) {
            var d = result.perPerson[emp.name];
            if (d.isNoRest) noRestPeople.push(emp.name);
            if (d.restType === 'split') splitRestPeople.push(emp.name);
        });

        if (noRestPeople.length > 0) {
            result.suggestions.push({
                icon: '🚨',
                text: noRestPeople.join('、') + ' 本周没有休息，必须安排至少1天休息'
            });
        }
        if (splitRestPeople.length > 0) {
            result.suggestions.push({
                icon: '💡',
                text: splitRestPeople.join('、') + ' 的休息日被拆开了，建议调成连休'
            });
        }

        // 周末值班公平性
        var weekendDutyMap = {};
        self.employees.forEach(function(emp) {
            weekendDutyMap[emp.name] = result.perPerson[emp.name].weekendDutyDays.length;
        });
        // 同班次内对比
        ['morning', 'middle', 'night'].forEach(function(shift) {
            var group = self.employees.filter(function(e) { return e.shift === shift; });
            if (group.length <= 1) return;
            var duties = group.map(function(e) { return weekendDutyMap[e.name]; });
            var max = Math.max.apply(null, duties);
            var min = Math.min.apply(null, duties);
            if (max - min >= 2) {
                var maxName = group.find(function(e) { return weekendDutyMap[e.name] === max; }).name;
                var minName = group.find(function(e) { return weekendDutyMap[e.name] === min; }).name;
                result.suggestions.push({
                    icon: '⚖️',
                    text: SHIFT_CONFIG[shift].label + '组：' + maxName + ' 周末值了' + max + '天，' + minName + ' 只值了' + min + '天，建议下周平衡'
                });
            }
        });

        if (result.warnings.length === 0) {
            result.suggestions.push({ icon: '✅', text: '本周排班合理，没有严重问题 👍' });
        }

        result.summary = {
            totalEmployees: self.employees.length,
            weekType: self.weekType === 'big' ? '大休周（双休）' : '小休周（单休）',
            busyness: self.busyness === 'light' ? '宽松' : self.busyness === 'busy' ? '繁忙' : '正常',
            dateRange: self.dates[0] + ' ~ ' + self.dates[6]
        };

        return result;
    };

    // 手动修改某天某人的状态（上班/休息）
    Scheduler.prototype.updateDay = function(dateStr, empName, newStatus) {
        var daySched = this.schedule[dateStr];
        if (!daySched) return;

        var emp = this.employees.find(function(e) { return e.name === empName; });
        if (!emp) return;

        // 先从所有列表移除
        ['morning', 'middle', 'night', 'rest'].forEach(function(key) {
            var idx = daySched[key].indexOf(empName);
            if (idx >= 0) daySched[key].splice(idx, 1);
        });

        // 加入新状态
        if (newStatus === 'rest') {
            daySched.rest.push(empName);
        } else {
            // 按固定班次上班
            daySched[emp.shift].push(empName);
        }
    };

    // 重新分析（手动修改后调用）
    Scheduler.prototype.reAnalyze = function() {
        return this._analyze();
    };

    // 工具
    function _formatDate(d) {
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }

    // 暴露班次配置供外部使用
    Scheduler.SHIFT_CONFIG = SHIFT_CONFIG;
    Scheduler.DAY_NAMES = DAY_NAMES;

    return Scheduler;
})();
