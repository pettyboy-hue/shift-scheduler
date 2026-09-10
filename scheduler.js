/**
 * 排班核心算法
 * 
 * 设计思路：
 * 1. 先确定每天的类型（工作日/大休日/小休日）
 * 2. 把员工分成 A/B 两组，交替执行大小休
 * 3. 大休周的周六日：休息组休息，但需要安排值班人员覆盖
 * 4. 人性化保障：避免晚班后接早班，工时公平分配，双休日连休
 */

var ShiftScheduler = (function() {

    function ShiftScheduler(config) {
        this.employees = config.employees || [];
        this.year = config.year;
        this.month = config.month; // 1-12
        this.firstWeekType = config.firstWeekType || 'big';
        this.weekdayPerShift = config.weekdayPerShift || 2;
        this.weekendPerShift = config.weekendPerShift || 1;
        this.enableNightShift = config.enableNightShift !== false;

        this.SHIFTS = ['morning', 'middle'];
        if (this.enableNightShift) {
            this.SHIFTS.push('night');
        }

        this.schedule = {};
        this.dateMeta = {};
        this.stats = {};
        this.groupA = [];
        this.groupB = [];
    }

    // 主入口
    ShiftScheduler.prototype.generate = function() {
        var minNeeded = this.weekdayPerShift * this.SHIFTS.length;
        if (this.employees.length < minNeeded) {
            throw new Error(
                '员工人数不足！至少需要 ' + minNeeded + ' 人' +
                '（' + this.SHIFTS.length + '个班次 x 每班' + this.weekdayPerShift + '人），' +
                '当前只有 ' + this.employees.length + ' 人'
            );
        }

        this._buildDateMeta();
        this._assignGroups();
        this._generateSchedule();
        return this.schedule;
    };

    // 构建日期元数据：确定每天属于哪一周、大休还是小休、是否休息日
    ShiftScheduler.prototype._buildDateMeta = function() {
        var daysInMonth = new Date(this.year, this.month, 0).getDate();
        var currentWeekIndex = 0;
        var currentWeekType = this.firstWeekType;

        for (var d = 1; d <= daysInMonth; d++) {
            var date = new Date(this.year, this.month - 1, d);
            var dayOfWeek = date.getDay(); // 0=周日
            var dateStr = this._formatDate(date);

            // 周一开始新一周
            if (dayOfWeek === 1 && d > 1) {
                currentWeekIndex++;
                currentWeekType = currentWeekType === 'big' ? 'small' : 'big';
            }

            var isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            var isRest = false;

            if (currentWeekType === 'big') {
                // 大休周：周六+周日都休
                isRest = isWeekend;
            } else {
                // 小休周：只有周日休
                isRest = dayOfWeek === 0;
            }

            this.dateMeta[dateStr] = {
                date: dateStr,
                dayOfWeek: dayOfWeek,
                weekIndex: currentWeekIndex,
                weekType: currentWeekType,
                isRest: isRest,
                isWeekend: isWeekend,
                dayNum: d
            };
        }
    };

    // 分组：A/B 两组交替大小休
    ShiftScheduler.prototype._assignGroups = function() {
        var half = Math.ceil(this.employees.length / 2);
        this.groupA = this.employees.slice(0, half);
        this.groupB = this.employees.slice(half);
    };

    // 逐天生成排班
    ShiftScheduler.prototype._generateSchedule = function() {
        var self = this;
        var dates = Object.keys(this.dateMeta).sort();

        // 初始化统计
        var stats = {};
        this.employees.forEach(function(emp) {
            stats[emp] = {
                morning: 0, middle: 0, night: 0,
                rest: 0, weekendDuty: 0, totalWork: 0,
                lastShift: null,
                consecutiveWork: 0
            };
        });

        dates.forEach(function(dateStr) {
            var meta = self.dateMeta[dateStr];
            var daySchedule = { morning: [], middle: [], rest: [] };
            if (self.enableNightShift) {
                daySchedule.night = [];
            }

            var perShift = meta.isRest ? self.weekendPerShift : self.weekdayPerShift;

            // 确定 A/B 组本周类型
            var groupAType, groupBType;
            if (meta.weekIndex % 2 === 0) {
                groupAType = self.firstWeekType;
                groupBType = self.firstWeekType === 'big' ? 'small' : 'big';
            } else {
                groupBType = self.firstWeekType;
                groupAType = self.firstWeekType === 'big' ? 'small' : 'big';
            }

            // 判断哪组今天休息
            var restGroupMembers = [];
            var workGroupMembers = [];

            if (self._shouldGroupRest(groupAType, meta)) {
                restGroupMembers = restGroupMembers.concat(self.groupA);
            } else {
                workGroupMembers = workGroupMembers.concat(self.groupA);
            }

            if (self._shouldGroupRest(groupBType, meta)) {
                restGroupMembers = restGroupMembers.concat(self.groupB);
            } else {
                workGroupMembers = workGroupMembers.concat(self.groupB);
            }

            if (meta.isRest) {
                // === 休息日：需要安排值班 ===
                var available = workGroupMembers.slice();
                var restPool = restGroupMembers.slice().sort(function(a, b) {
                    return stats[a].weekendDuty - stats[b].weekendDuty;
                });

                self.SHIFTS.forEach(function(shift) {
                    var needed = perShift;
                    var assigned = self._pickBest(available, needed, shift, stats);

                    // 从可用池移除已分配的人
                    assigned.forEach(function(name) {
                        var idx = available.indexOf(name);
                        if (idx >= 0) available.splice(idx, 1);
                    });

                    // 工作组不够时，从休息组补充
                    if (assigned.length < needed) {
                        var extraNeeded = needed - assigned.length;
                        var extra = self._pickBest(restPool, extraNeeded, shift, stats);
                        assigned = assigned.concat(extra);
                        extra.forEach(function(name) {
                            var idx = restPool.indexOf(name);
                            if (idx >= 0) restPool.splice(idx, 1);
                            stats[name].weekendDuty++;
                        });
                    }

                    daySchedule[shift] = assigned;
                });

                // 未被分配的人休息
                var allAssigned = {};
                self.SHIFTS.forEach(function(s) {
                    (daySchedule[s] || []).forEach(function(n) { allAssigned[n] = true; });
                });
                daySchedule.rest = self.employees.filter(function(e) { return !allAssigned[e]; });

            } else {
                // === 工作日 ===
                var allAvailable = self.employees.slice();

                self.SHIFTS.forEach(function(shift) {
                    var needed = perShift;
                    var assigned = self._pickBest(allAvailable, needed, shift, stats);
                    daySchedule[shift] = assigned;
                    assigned.forEach(function(name) {
                        var idx = allAvailable.indexOf(name);
                        if (idx >= 0) allAvailable.splice(idx, 1);
                    });
                });

                daySchedule.rest = allAvailable;
            }

            // 更新统计
            self.SHIFTS.forEach(function(shift) {
                (daySchedule[shift] || []).forEach(function(name) {
                    stats[name][shift]++;
                    stats[name].totalWork++;
                    stats[name].lastShift = shift;
                    stats[name].consecutiveWork++;
                });
            });
            (daySchedule.rest || []).forEach(function(name) {
                stats[name].rest++;
                stats[name].lastShift = 'rest';
                stats[name].consecutiveWork = 0;
            });

            self.schedule[dateStr] = daySchedule;
        });

        this.stats = stats;
    };

    // 判断某组某天是否休息
    ShiftScheduler.prototype._shouldGroupRest = function(groupType, meta) {
        if (groupType === 'big') {
            return meta.isWeekend;
        } else {
            return meta.dayOfWeek === 0;
        }
    };

    /**
     * 从候选人中挑选最佳人选
     * 
     * 评分规则（分数越低越优先）：
     * - 晚班后接早班 +1000（严格避免）
     * - 中班后接早班 +100（尽量避免）
     * - 连续工作>=6天 +500
     * - 总工作天数 *10（公平性）
     * - 该班次累计 *5（均衡班次）
     * - 微量随机扰动
     */
    ShiftScheduler.prototype._pickBest = function(candidates, count, shift, stats) {
        if (candidates.length === 0 || count === 0) return [];

        var scored = candidates.map(function(name) {
            var s = stats[name];
            var score = 0;

            // 晚班后接早班：凌晨5点下班，9点上班，只有4小时休息，身体受不了
            if (shift === 'morning' && s.lastShift === 'night') {
                score += 1000;
            }
            // 中班后接早班：凌晨1点下班，9点上班，只有8小时不够
            if (shift === 'morning' && s.lastShift === 'middle') {
                score += 100;
            }

            // 连续工作太久需要休息
            if (s.consecutiveWork >= 6) {
                score += 500;
            } else if (s.consecutiveWork >= 5) {
                score += 200;
            }

            // 工作总天数越多，分数越高（让工作少的人优先）
            score += s.totalWork * 10;

            // 该班次上班次数越多，分数越高（均衡各班次）
            score += (s[shift] || 0) * 5;

            // 微量随机扰动，避免死板
            score += Math.random() * 3;

            return { name: name, score: score };
        });

        scored.sort(function(a, b) { return a.score - b.score; });
        return scored.slice(0, count).map(function(s) { return s.name; });
    };

    ShiftScheduler.prototype.getStats = function() { return this.stats; };
    ShiftScheduler.prototype.getDateMeta = function() { return this.dateMeta; };

    // 手动修改某天某人的班次
    ShiftScheduler.prototype.updateShift = function(dateStr, employeeName, newShift) {
        var daySchedule = this.schedule[dateStr];
        if (!daySchedule) return;

        var allShifts = this.SHIFTS.concat(['rest']);
        // 先从所有班次移除
        allShifts.forEach(function(shift) {
            if (daySchedule[shift]) {
                var idx = daySchedule[shift].indexOf(employeeName);
                if (idx >= 0) daySchedule[shift].splice(idx, 1);
            }
        });

        // 加入新班次
        if (daySchedule[newShift]) {
            daySchedule[newShift].push(employeeName);
        }
    };

    ShiftScheduler.prototype._formatDate = function(date) {
        var y = date.getFullYear();
        var m = String(date.getMonth() + 1);
        if (m.length < 2) m = '0' + m;
        var d = String(date.getDate());
        if (d.length < 2) d = '0' + d;
        return y + '-' + m + '-' + d;
    };

    return ShiftScheduler;

})();
