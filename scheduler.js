/**
 * 排班核心算法 v5
 * 
 * 铁律：每个员工的班次永远不变！
 * 罗凯=早班，陈力柳鹏=中班，袁继春罗浩文陈阳倩罗森鹏=晚班
 * 排班只决定"今天来不来"，来了就上自己固定的班，绝不调到别的班次
 *
 * 大休（双休）：
 *   - 周一~周五正常满员
 *   - 周六周日班次减半，尽量让员工连休（周六+周日一起休）
 *
 * 小休（单休）：
 *   - 周一~周五正常满员
 *   - 同班次的人拆成两半：A组周六休，B组周日休
 *   - 这样周六周日都有人上班，每人只休一天
 *   - 周六周日班次各留一半人
 */

var ShiftScheduler = (function () {

    var SHIFTS = {
        morning: { label: '早', fullLabel: '☀️ 早班', time: '09:00-18:00', hours: 9, weekdayNeed: 1 },
        middle:  { label: '中', fullLabel: '🌤️ 中班', time: '16:00-次日01:00', hours: 9, weekdayNeed: 2 },
        night:   { label: '晚', fullLabel: '🌙 晚班', time: '21:00-次日05:00', hours: 8, weekdayNeed: 2 }
    };

    var DAYS = ['日', '一', '二', '三', '四', '五', '六'];

    function Scheduler(cfg) {
        this.employees = cfg.employees || [];
        this.weekStart = cfg.weekStart;
        this.weekType = cfg.weekType || 'big';
        this.bizLevel = cfg.bizLevel || 'normal';
        this.specials = cfg.specials || {}; // { 姓名: { type:'leave'|'dayoff', days:['2025-01-06'] } }
    }

    /* ========== 生成 ========== */
    Scheduler.prototype.generate = function () {
        this._buildDates();
        this._buildGroups();
        this.schedule = {}; // { 'YYYY-MM-DD': { morning:[], middle:[], night:[], rest:[] } }

        for (var i = 0; i < 7; i++) {
            var d = this.dates[i];
            this.schedule[d] = { morning: [], middle: [], night: [], rest: [] };
        }

        if (this.weekType === 'big') {
            this._assignBigWeek();
        } else {
            this._assignSmallWeek();
        }

        return { schedule: this.schedule, dates: this.dates, meta: this.meta, analysis: this.analyze() };
    };

    /* 构建日期数组 */
    Scheduler.prototype._buildDates = function () {
        this.dates = [];
        this.meta = {};
        var start = new Date(this.weekStart + 'T00:00:00');
        for (var i = 0; i < 7; i++) {
            var d = new Date(start);
            d.setDate(d.getDate() + i);
            var s = fmt(d);
            this.dates.push(s);
            var dow = d.getDay();
            this.meta[s] = {
                dow: dow,
                dayName: DAYS[dow],
                isWeekend: dow === 0 || dow === 6,
                isSat: dow === 6,
                isSun: dow === 0,
                label: (d.getMonth() + 1) + '/' + d.getDate()
            };
        }
    };

    /* 按班次分组 */
    Scheduler.prototype._buildGroups = function () {
        this.groups = { morning: [], middle: [], night: [] };
        var self = this;
        this.employees.forEach(function (e) {
            if (self.groups[e.shift]) self.groups[e.shift].push(e.name);
        });
    };

    /* 判断某人某天是否有特殊情况（请假/调休）*/
    Scheduler.prototype._isSpecialOff = function (name, dateStr) {
        var sp = this.specials[name];
        if (!sp || !sp.days) return false;
        return sp.days.indexOf(dateStr) >= 0;
    };

    /* ===== 大休周（双休）===== 
     * 周一~周五：满员
     * 周六+周日：减半值班，尽量让同一批人连休
     *
     * 早班(1人)：罗凯周六周日看业务，宽松都不排，正常排1天
     * 中班(2人)：周末1人值班，另1人连休 → 两人轮换
     * 晚班(4人)：工作日每天2人，周末1人
     *   - 先确定周末谁值班（1人），剩下3人连休
     *   - 工作日5天每天需要2人，4人轮换确保每人至少休1天
     */
    Scheduler.prototype._assignBigWeek = function () {
        var self = this;
        var weekdays = this.dates.slice(0, 5); // 周一~周五
        var sat = this.dates[5];
        var sun = this.dates[6];

        /* --- 早班 --- */
        var morningPerson = this.groups.morning[0]; // 罗凯
        if (morningPerson) {
            // 工作日都上
            weekdays.forEach(function (d) {
                if (!self._isSpecialOff(morningPerson, d)) {
                    self.schedule[d].morning.push(morningPerson);
                }
            });
            // 周末：宽松不排，正常/繁忙排
            if (this.bizLevel !== 'light') {
                // 大休周末也给罗凯安排一天？不，双休就让他休
                // 但如果繁忙就两天都排
                if (this.bizLevel === 'busy') {
                    if (!self._isSpecialOff(morningPerson, sat)) self.schedule[sat].morning.push(morningPerson);
                    if (!self._isSpecialOff(morningPerson, sun)) self.schedule[sun].morning.push(morningPerson);
                }
                // 正常情况大休周末白班不排人（只有1个人，让他双休）
            }
        }

        /* --- 中班 --- */
        var midPool = this.groups.middle.slice();
        // 工作日全部上
        weekdays.forEach(function (d) {
            midPool.forEach(function (name) {
                if (!self._isSpecialOff(name, d)) {
                    self.schedule[d].middle.push(name);
                }
            });
        });
        // 周末：1人值班1人休。让A值周六+周日，B连休（或反过来交替）
        // 这里用评分选值班人（谁历史周末值班少谁来）
        var midWeekendWorker = this._pickLeastBusy(midPool, 'weekendDuty');
        if (midWeekendWorker && !self._isSpecialOff(midWeekendWorker, sat)) {
            self.schedule[sat].middle.push(midWeekendWorker);
        }
        if (midWeekendWorker && !self._isSpecialOff(midWeekendWorker, sun)) {
            self.schedule[sun].middle.push(midWeekendWorker);
        }

        /* --- 晚班 --- */
        var nightPool = this.groups.night.slice();
        // 先确定周末值班人（1人同时值周六+周日，保证其他3人连休）
        var nightWeekendWorker = this._pickLeastBusy(nightPool, 'weekendDuty');
        if (nightWeekendWorker && !self._isSpecialOff(nightWeekendWorker, sat)) {
            self.schedule[sat].night.push(nightWeekendWorker);
        }
        if (nightWeekendWorker && !self._isSpecialOff(nightWeekendWorker, sun)) {
            self.schedule[sun].night.push(nightWeekendWorker);
        }

        // 工作日：每天需要2人，4人轮换
        // 周末值班那人工作日也要排，但要保证他总工作天数不会太多
        // 策略：给4人打分排序，每天选最该上班的2人
        this._assignNightWeekdays(nightPool, weekdays);

        // 最后：没被排到的人当天都进rest
        this.dates.forEach(function (d) {
            var working = {};
            ['morning', 'middle', 'night'].forEach(function (s) {
                self.schedule[d][s].forEach(function (n) { working[n] = true; });
            });
            self.employees.forEach(function (e) {
                if (!working[e.name]) {
                    self.schedule[d].rest.push(e.name);
                }
            });
        });
    };

    /* ===== 小休周（单休）=====
     * 核心：同班次拆成两半，A组周六休，B组周日休
     * 这样周六周日都有人，每人休1天
     *
     * 早班(1人)：只有罗凯，周六周日选一天休（默认周日休）
     * 中班(2人)：陈力周六休+周日上，柳鹏周六上+周日休
     * 晚班(4人)：4人分AB两组
     *   - A组(2人)周六休，周日上
     *   - B组(2人)周日休，周六上
     *   - 工作日每天仍然2人轮换
     */
    Scheduler.prototype._assignSmallWeek = function () {
        var self = this;
        var weekdays = this.dates.slice(0, 5);
        var sat = this.dates[5];
        var sun = this.dates[6];

        /* --- 早班 --- */
        var morningPerson = this.groups.morning[0];
        if (morningPerson) {
            // 工作日+周六都上，周日休
            weekdays.forEach(function (d) {
                if (!self._isSpecialOff(morningPerson, d)) {
                    self.schedule[d].morning.push(morningPerson);
                }
            });
            // 周六上班
            if (!self._isSpecialOff(morningPerson, sat)) {
                self.schedule[sat].morning.push(morningPerson);
            }
            // 周日休息（单休）
        }

        /* --- 中班拆半 --- */
        var midPool = this.groups.middle.slice();
        // 工作日全部上
        weekdays.forEach(function (d) {
            midPool.forEach(function (name) {
                if (!self._isSpecialOff(name, d)) {
                    self.schedule[d].middle.push(name);
                }
            });
        });
        // 拆半：第1人周六休周日上，第2人周六上周日休
        if (midPool.length >= 2) {
            var midA = midPool[0]; // 周六休
            var midB = midPool[1]; // 周日休
            // 周六：B上班
            if (!self._isSpecialOff(midB, sat)) self.schedule[sat].middle.push(midB);
            // 周日：A上班
            if (!self._isSpecialOff(midA, sun)) self.schedule[sun].middle.push(midA);
        } else if (midPool.length === 1) {
            // 只有1人，周六上周日休
            if (!self._isSpecialOff(midPool[0], sat)) self.schedule[sat].middle.push(midPool[0]);
        }

        /* --- 晚班拆半 --- */
        var nightPool = this.groups.night.slice();
        // 分成AB两组（各2人）
        var half = Math.ceil(nightPool.length / 2);
        var groupA = nightPool.slice(0, half);  // 周六休
        var groupB = nightPool.slice(half);     // 周日休

        // 工作日：4人中每天选2人轮换
        this._assignNightWeekdays(nightPool, weekdays);

        // 周六：B组上班（A组休）
        groupB.forEach(function (name) {
            if (!self._isSpecialOff(name, sat)) {
                self.schedule[sat].night.push(name);
            }
        });
        // 周日：A组上班（B组休）
        groupA.forEach(function (name) {
            if (!self._isSpecialOff(name, sun)) {
                self.schedule[sun].night.push(name);
            }
        });

        // rest
        this.dates.forEach(function (d) {
            var working = {};
            ['morning', 'middle', 'night'].forEach(function (s) {
                self.schedule[d][s].forEach(function (n) { working[n] = true; });
            });
            self.employees.forEach(function (e) {
                if (!working[e.name]) {
                    self.schedule[d].rest.push(e.name);
                }
            });
        });
    };

    /* 晚班工作日轮换：4人每天选2人 */
    Scheduler.prototype._assignNightWeekdays = function (pool, weekdays) {
        var self = this;
        // 记录每人本周已排几天（工作日部分）
        var workCount = {};
        pool.forEach(function (n) { workCount[n] = 0; });

        weekdays.forEach(function (d) {
            // 过滤掉请假的
            var available = pool.filter(function (n) {
                return !self._isSpecialOff(n, d);
            });
            var need = Math.min(SHIFTS.night.weekdayNeed, available.length);

            // 按工作天数升序（少的优先上），天数相同则随机
            available.sort(function (a, b) {
                var diff = workCount[a] - workCount[b];
                return diff !== 0 ? diff : Math.random() - 0.5;
            });

            var selected = available.slice(0, need);
            selected.forEach(function (n) {
                self.schedule[d].night.push(n);
                workCount[n]++;
            });
        });
    };

    /* 选历史周末值班最少的人 */
    Scheduler.prototype._pickLeastBusy = function (pool, metric) {
        if (pool.length === 0) return null;
        // 简单实现：目前没有跨周历史，随机选（后续可接入localStorage历史）
        return pool[Math.floor(Math.random() * pool.length)];
    };

    /* ========== 手动修改 ========== */
    Scheduler.prototype.updateDay = function (dateStr, empName, toStatus) {
        var day = this.schedule[dateStr];
        if (!day) return;
        var emp = this.employees.find(function (e) { return e.name === empName; });
        if (!emp) return;

        // 先从所有列表中移除
        ['morning', 'middle', 'night', 'rest'].forEach(function (k) {
            var idx = day[k].indexOf(empName);
            if (idx >= 0) day[k].splice(idx, 1);
        });

        // 放到目标位置（只能是自己的固定班次或rest）
        if (toStatus === 'rest') {
            day.rest.push(empName);
        } else {
            day[emp.shift].push(empName);
        }
    };

    /* ========== 分析 ========== */
    Scheduler.prototype.analyze = function () {
        var self = this;
        var result = {
            persons: {},
            warnings: [],
            suggestions: []
        };

        this.employees.forEach(function (emp) {
            var name = emp.name;
            var shift = emp.shift;
            var info = {
                name: name,
                shift: shift,
                shiftLabel: SHIFTS[shift].fullLabel,
                shiftTime: SHIFTS[shift].time,
                workDays: [],
                restDays: [],
                weekendWork: [],
                maxConsecutive: 0,
                totalHours: 0,
                restType: '',   // double|single|split|none
                restEmoji: '',
                restText: '',
                issues: []
            };

            var consec = 0, maxC = 0;
            self.dates.forEach(function (d) {
                var isRest = self.schedule[d].rest.indexOf(name) >= 0;
                if (isRest) {
                    info.restDays.push(d);
                    if (consec > maxC) maxC = consec;
                    consec = 0;
                } else {
                    info.workDays.push(d);
                    consec++;
                    if (self.meta[d].isWeekend) info.weekendWork.push(d);
                }
            });
            if (consec > maxC) maxC = consec;
            info.maxConsecutive = maxC;
            info.totalHours = info.workDays.length * SHIFTS[shift].hours;

            // 判断休息类型
            var rc = info.restDays.length;
            if (rc === 0) {
                info.restType = 'none';
                info.restEmoji = '🔴';
                info.restText = '无休';
                info.issues.push({ lv: 'danger', msg: '本周没有任何休息！' });
                result.warnings.push('🔴 ' + name + ' 本周无休，请务必调整！');
            } else if (rc === 1) {
                info.restType = 'single';
                info.restEmoji = '🟡';
                info.restText = '单休';
            } else {
                // 检查是否连续
                var sorted = info.restDays.slice().sort();
                var isConsec = true;
                for (var i = 1; i < sorted.length; i++) {
                    if ((new Date(sorted[i]) - new Date(sorted[i - 1])) / 86400000 > 1) {
                        isConsec = false; break;
                    }
                }
                if (isConsec) {
                    info.restType = 'double';
                    info.restEmoji = '🟢';
                    info.restText = '连休' + rc + '天';
                } else {
                    info.restType = 'split';
                    info.restEmoji = '🟠';
                    info.restText = '拆休' + rc + '天';
                    info.issues.push({ lv: 'warn', msg: '休息日不连续，建议调成连休' });
                }
            }

            // 连续工作预警
            if (maxC >= 7) {
                info.issues.push({ lv: 'danger', msg: '连续工作' + maxC + '天！严重超负荷' });
                result.warnings.push('🔴 ' + name + ' 连续工作' + maxC + '天！');
            } else if (maxC >= 6) {
                info.issues.push({ lv: 'danger', msg: '连续工作' + maxC + '天，需要休息' });
                result.warnings.push('⚠️ ' + name + ' 连续工作' + maxC + '天');
            } else if (maxC >= 5) {
                info.issues.push({ lv: 'warn', msg: '连续工作' + maxC + '天，较辛苦' });
            }

            result.persons[name] = info;
        });

        // 晚班公平性
        var nightPpl = self.employees.filter(function (e) { return e.shift === 'night'; });
        if (nightPpl.length > 2) {
            var counts = nightPpl.map(function (e) { return { n: e.name, d: result.persons[e.name].workDays.length }; });
            var max = Math.max.apply(null, counts.map(function (c) { return c.d; }));
            var min = Math.min.apply(null, counts.map(function (c) { return c.d; }));
            if (max - min >= 2) {
                var most = counts.find(function (c) { return c.d === max; });
                var least = counts.find(function (c) { return c.d === min; });
                result.suggestions.push('⚖️ 晚班工作不均：' + most.n + '上' + max + '天，' + least.n + '上' + min + '天，建议微调');
            }
        }

        // 无休建议
        var noRest = [];
        self.employees.forEach(function (e) {
            if (result.persons[e.name].restType === 'none') noRest.push(e.name);
        });
        if (noRest.length) {
            result.suggestions.push('🚨 ' + noRest.join('、') + ' 本周无休，必须安排休息');
        }

        var splitRest = [];
        self.employees.forEach(function (e) {
            if (result.persons[e.name].restType === 'split') splitRest.push(e.name);
        });
        if (splitRest.length) {
            result.suggestions.push('💡 ' + splitRest.join('、') + ' 休息日被拆开了，建议调成连休');
        }

        if (result.warnings.length === 0 && result.suggestions.length === 0) {
            result.suggestions.push('✅ 本周排班合理，没有问题 👍');
        }

        return result;
    };

    function fmt(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    Scheduler.SHIFTS = SHIFTS;
    Scheduler.DAYS = DAYS;
    return Scheduler;
})();
