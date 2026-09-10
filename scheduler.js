/**
 * 排班核心算法 v4 - 工作日满员 + 仅双休日减半
 * 
 * 核心规则：
 * 1. 每个员工有固定班次（早/中/晚），永远不变
 * 2. 工作日（含小休周的周六）：所有班次必须满员
 *    - 早班 1人、中班 2人、晚班 2人
 * 3. 仅双休周（大休）的周六+周日才可以减半
 *    - 早班 0-1人、中班 1人、晚班 1人
 * 4. 晚班4人轮换：工作日每天必排2人，通过轮换保证每人公平
 * 5. 支持调休假、请假等特殊情况
 * 6. 早班只有1人（罗凯），工作日必排，双休日视业务可空
 */

var ShiftScheduler = (function() {

    // 班次配置
    var SHIFT_CONFIG = {
        morning: { 
            hours: 9, 
            label: '早班', 
            time: '09:00-18:00', 
            // 工作日必须满员：1人
            weekdayCount: 1, 
            // 双休日减半：宽松时0人，正常时1人
            weekendReducedCount: 1, 
            lightWeekendCount: 0 
        },
        middle: { 
            hours: 9, 
            label: '中班', 
            time: '16:00-01:00', 
            weekdayCount: 2, 
            weekendReducedCount: 1, 
            lightWeekendCount: 1 
        },
        night: { 
            hours: 8, 
            label: '晚班', 
            time: '21:00-05:00', 
            weekdayCount: 2, 
            weekendReducedCount: 1, 
            lightWeekendCount: 1 
        }
    };

    var DAY_NAMES = ['日','一','二','三','四','五','六'];

    function Scheduler(config) {
        this.employees = config.employees || [];
        this.weekStart = config.weekStart;
        this.weekType = config.weekType || 'big'; // 'big'=双休 'small'=单休
        this.busyness = config.busyness || 'normal';
        // specials: { name: { type: 'leave'|'dayoff', days: ['YYYY-MM-DD',...] } }
        this.specials = config.specials || {};
        this.history = config.history || {};

        this.schedule = {};
        this.dates = [];
        this.dateMeta = {};
    }

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

    Scheduler.prototype._buildDates = function() {
        var start = new Date(this.weekStart + 'T00:00:00');
        for (var i = 0; i < 7; i++) {
            var d = new Date(start);
            d.setDate(d.getDate() + i);
            var dateStr = _formatDate(d);
            var dow = d.getDay();

            // 关键判断：这一天是否属于"可减半日"
            // 只有大休周的周六(6)和周日(0)才是可减半日
            var isReducedDay = false;
            if (this.weekType === 'big' && (dow === 0 || dow === 6)) {
                isReducedDay = true;
            }

            // 是否是休息日（用于分析，不影响排班人数逻辑）
            var isRestDay = false;
            if (this.weekType === 'big') {
                isRestDay = (dow === 0 || dow === 6);
            } else {
                isRestDay = (dow === 0);
            }

            this.dates.push(dateStr);
            this.dateMeta[dateStr] = {
                date: dateStr,
                dayOfWeek: dow,
                dayName: DAY_NAMES[dow],
                isWeekend: (dow === 0 || dow === 6),
                isRestDay: isRestDay,
                isReducedDay: isReducedDay, // 这一天班次人员是否减半
                dayIndex: i
            };
        }
    };

    Scheduler.prototype._assignShifts = function() {
        var self = this;
        
        // 按班次分组
        var groups = { morning: [], middle: [], night: [] };
        this.employees.forEach(function(emp) {
            if (groups[emp.shift]) {
                groups[emp.shift].push(emp.name);
            }
        });

        // 逐天排班
        this.dates.forEach(function(dateStr) {
            var meta = self.dateMeta[dateStr];
            var daySchedule = { morning: [], middle: [], night: [], rest: [] };

            ['morning', 'middle', 'night'].forEach(function(shift) {
                var conf = SHIFT_CONFIG[shift];
                var pool = groups[shift].slice();

                // 排除今天请假/调休的人
                pool = pool.filter(function(name) {
                    var sp = self.specials[name];
                    if (!sp) return true;
                    if (sp.days && sp.days.indexOf(dateStr) >= 0) return false;
                    return true;
                });

                // 确定今天需要几人——核心逻辑
                var needed;
                if (meta.isReducedDay) {
                    // 只有大休周的周六周日才减半
                    if (self.busyness === 'light' && shift === 'morning') {
                        // 宽松 + 白班 → 周末可以不排人
                        needed = conf.lightWeekendCount;
                    } else if (self.busyness === 'busy') {
                        // 繁忙时即使双休日也满员
                        needed = conf.weekdayCount;
                    } else {
                        // 正常情况下双休日减半
                        needed = conf.weekendReducedCount;
                    }
                } else {
                    // 工作日（含小休周的周六）→ 必须满员
                    needed = conf.weekdayCount;
                }

                // 不能超过可用人数
                needed = Math.min(needed, pool.length);

                // 选人
                var selected = self._selectWorkers(pool, needed, shift, dateStr, meta);
                daySchedule[shift] = selected;
            });

            // 剩余的人今天休息
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
     * 评分越低越优先上班（让疲劳的人多休息）
     * 关键规则：
     * - 工作日必须满员，所以评分只影响"谁上"而不影响"上几个"
     * - 晚班4人每天选2人，评分决定轮换顺序
     * - 连续工作天数过多 → 加分（让他休息）
     * - 本周已工作天数多 → 加分（保证周内公平）
     * - 历史周末值班多 → 在周末时加分
     */
    Scheduler.prototype._selectWorkers = function(pool, count, shift, dateStr, meta) {
        if (count === 0 || pool.length === 0) return [];
        // 如果需要的人数≥可用人数，全部上班
        if (count >= pool.length) return pool.slice();

        var self = this;

        var scored = pool.map(function(name) {
            var score = 0;
            var hist = self.history[name] || { totalWork: 0, weekendDuty: 0, totalRest: 0 };

            // 本周已连续工作了几天
            var consecutiveWork = 0;
            for (var i = self.dates.indexOf(dateStr) - 1; i >= 0; i--) {
                var prevDate = self.dates[i];
                var prevSched = self.schedule[prevDate];
                if (prevSched && prevSched.rest.indexOf(name) >= 0) break;
                consecutiveWork++;
            }

            // 连续工作越多，越应该让他休息（分高=靠后=休息）
            if (consecutiveWork >= 6) score += 1000;  // 绝对不能再排了
            else if (consecutiveWork >= 5) score += 500;
            else if (consecutiveWork >= 4) score += 200;
            else if (consecutiveWork >= 3) score += 80;
            else score += consecutiveWork * 15;

            // 本周已工作天数越多，分越高
            var thisWeekWork = 0;
            for (var j = 0; j < self.dates.indexOf(dateStr); j++) {
                var prev = self.dates[j];
                var ps = self.schedule[prev];
                if (ps && ps.rest.indexOf(name) < 0) thisWeekWork++;
            }
            score += thisWeekWork * 25;

            // 历史总工作天数
            score += (hist.totalWork || 0) * 3;

            // 如果是周末，历史周末值班多的人分高
            if (meta.isWeekend) {
                score += (hist.weekendDuty || 0) * 40;
            }

            // 微量随机扰动防止每次结果完全相同
            score += Math.random() * 3;

            return { name: name, score: score };
        });

        // 分数低的优先上班
        scored.sort(function(a, b) { return a.score - b.score; });
        return scored.slice(0, count).map(function(s) { return s.name; });
    };

    // 分析排班结果
    Scheduler.prototype._analyze = function() {
        var self = this;
        var result = {
            perPerson: {},
            warnings: [],
            suggestions: [],
            summary: {},
            shiftCoverage: {} // 每天各班次的满员情况
        };

        // 先检查每天各班次的覆盖情况
        this.dates.forEach(function(dateStr) {
            var meta = self.dateMeta[dateStr];
            var daySched = self.schedule[dateStr];
            var coverage = {};

            ['morning', 'middle', 'night'].forEach(function(shift) {
                var conf = SHIFT_CONFIG[shift];
                var actual = daySched[shift].length;
                var expected;

                if (meta.isReducedDay) {
                    if (self.busyness === 'light' && shift === 'morning') {
                        expected = conf.lightWeekendCount;
                    } else if (self.busyness === 'busy') {
                        expected = conf.weekdayCount;
                    } else {
                        expected = conf.weekendReducedCount;
                    }
                } else {
                    expected = conf.weekdayCount;
                }

                coverage[shift] = {
                    actual: actual,
                    expected: expected,
                    isFull: actual >= expected,
                    isShort: actual < expected
                };

                // 工作日人手不足预警
                if (!meta.isReducedDay && actual < expected) {
                    result.warnings.push(
                        '🔴 ' + dateStr.slice(5) + '(周' + meta.dayName + ') ' + 
                        conf.label + '人手不足：需要' + expected + '人，实际' + actual + '人'
                    );
                }
            });

            result.shiftCoverage[dateStr] = coverage;
        });

        // 每人分析
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
                isDoubleRest: false,
                isSingleRest: false,
                isNoRest: false,
                restType: '',
                restLabel: '',
                consecutiveWork: 0,
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

            // 休息类型分析
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

            // 连续工作预警
            if (data.consecutiveWork >= 7) {
                data.issues.push({ level: 'danger', text: '连续工作' + data.consecutiveWork + '天，严重超负荷！' });
                result.warnings.push('🔴 ' + name + ' 连续工作' + data.consecutiveWork + '天！');
            } else if (data.consecutiveWork >= 6) {
                data.issues.push({ level: 'danger', text: '连续工作' + data.consecutiveWork + '天，请尽快安排休息' });
                result.warnings.push('🔴 ' + name + ' 连续工作' + data.consecutiveWork + '天');
            } else if (data.consecutiveWork >= 5) {
                data.issues.push({ level: 'warning', text: '连续工作' + data.consecutiveWork + '天，较为辛苦' });
            }

            // 特殊情况标记
            if (data.special) {
                if (data.special.type === 'dayoff') {
                    data.issues.push({ level: 'info', text: '本周使用调休假 ' + data.special.days.length + ' 天' });
                } else if (data.special.type === 'leave') {
                    data.issues.push({ level: 'info', text: '本周请假 ' + data.special.days.length + ' 天' });
                }
            }

            result.perPerson[name] = data;
        });

        // 全局建议
        var noRestPeople = [];
        var splitRestPeople = [];
        var heavyWorkers = []; // 本周工作≥6天的人
        self.employees.forEach(function(emp) {
            var d = result.perPerson[emp.name];
            if (d.isNoRest) noRestPeople.push(emp.name);
            if (d.restType === 'split') splitRestPeople.push(emp.name);
            if (d.workDays.length >= 6) heavyWorkers.push({ name: emp.name, days: d.workDays.length });
        });

        if (noRestPeople.length > 0) {
            result.suggestions.push({
                icon: '🚨', text: noRestPeople.join('、') + ' 本周没有休息，必须安排至少1天休息'
            });
        }
        if (splitRestPeople.length > 0) {
            result.suggestions.push({
                icon: '💡', text: splitRestPeople.join('、') + ' 的休息日被拆开了，建议调成连休'
            });
        }
        if (heavyWorkers.length > 0) {
            result.suggestions.push({
                icon: '😓',
                text: heavyWorkers.map(function(w) { return w.name + '(' + w.days + '天)'; }).join('、') + 
                     ' 本周工作天数较多，建议下周适当补休'
            });
        }

        // 晚班轮换公平性检查（4人组内对比）
        var nightGroup = self.employees.filter(function(e) { return e.shift === 'night'; });
        if (nightGroup.length > 2) {
            var nightWork = nightGroup.map(function(e) { 
                return { name: e.name, days: result.perPerson[e.name].workDays.length };
            });
            var maxWork = Math.max.apply(null, nightWork.map(function(w) { return w.days; }));
            var minWork = Math.min.apply(null, nightWork.map(function(w) { return w.days; }));
            if (maxWork - minWork >= 2) {
                var maxP = nightWork.find(function(w) { return w.days === maxWork; });
                var minP = nightWork.find(function(w) { return w.days === minWork; });
                result.suggestions.push({
                    icon: '⚖️',
                    text: '晚班组工作不均：' + maxP.name + '上' + maxWork + '天、' + 
                          minP.name + '上' + minWork + '天，差距' + (maxWork - minWork) + '天'
                });
            }
        }

        // 周末值班公平性
        ['middle', 'night'].forEach(function(shift) {
            var group = self.employees.filter(function(e) { return e.shift === shift; });
            if (group.length <= 1) return;
            var duties = group.map(function(e) { 
                return { name: e.name, count: result.perPerson[e.name].weekendDutyDays.length }; 
            });
            var maxD = Math.max.apply(null, duties.map(function(d) { return d.count; }));
            var minD = Math.min.apply(null, duties.map(function(d) { return d.count; }));
            if (maxD - minD >= 2) {
                var maxN = duties.find(function(d) { return d.count === maxD; }).name;
                var minN = duties.find(function(d) { return d.count === minD; }).name;
                result.suggestions.push({
                    icon: '⚖️',
                    text: SHIFT_CONFIG[shift].label + '组周末值班不均：' + maxN + '值' + maxD + '天 vs ' + 
                          minN + '值' + minD + '天'
                });
            }
        });

        if (result.warnings.length === 0 && result.suggestions.length === 0) {
            result.suggestions.push({ icon: '✅', text: '本周排班合理，没有问题 👍' });
        }

        result.summary = {
            totalEmployees: self.employees.length,
            weekType: self.weekType === 'big' ? '大休周（双休）' : '小休周（单休）',
            busyness: self.busyness === 'light' ? '宽松' : self.busyness === 'busy' ? '繁忙' : '正常',
            dateRange: self.dates[0] + ' ~ ' + self.dates[6]
        };

        return result;
    };

    // 手动修改某天某人状态
    Scheduler.prototype.updateDay = function(dateStr, empName, newStatus) {
        var daySched = this.schedule[dateStr];
        if (!daySched) return;

        var emp = this.employees.find(function(e) { return e.name === empName; });
        if (!emp) return;

        ['morning', 'middle', 'night', 'rest'].forEach(function(key) {
            var idx = daySched[key].indexOf(empName);
            if (idx >= 0) daySched[key].splice(idx, 1);
        });

        if (newStatus === 'rest') {
            daySched.rest.push(empName);
        } else {
            daySched[emp.shift].push(empName);
        }
    };

    Scheduler.prototype.reAnalyze = function() {
        return this._analyze();
    };

    function _formatDate(d) {
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }

    Scheduler.SHIFT_CONFIG = SHIFT_CONFIG;
    Scheduler.DAY_NAMES = DAY_NAMES;

    return Scheduler;
})();
