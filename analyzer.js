/**
 * 排班健康分析器
 * 
 * 在排班生成或手动调整后，对每位员工的休息情况进行全面扫描，
 * 产出人性化的提示、预警、建议，让管理者一眼看出谁过得辛苦、谁还算轻松。
 */

var ShiftAnalyzer = (function() {

    // === 分析入口 ===
    function analyze(schedule, dateMeta, employees, shifts) {
        var dates = Object.keys(dateMeta).sort();
        var result = {
            employees: {},   // 每人的详细分析
            warnings: [],    // 全局预警
            suggestions: [], // 人性化建议
            fairness: {},    // 公平性指标
            weeklyBreakdown: {} // 每人每周休息详情
        };

        // 第一遍：采集每人每天数据
        employees.forEach(function(name) {
            var empData = {
                name: name,
                dailyShifts: {},   // dateStr -> shift
                restDays: [],      // 休息日期列表
                workDays: [],      // 工作日期列表
                shiftCounts: { morning: 0, middle: 0, night: 0, rest: 0 },
                weekendDutyDays: [],  // 周末值班日期
                issues: [],        // 此人的问题列表
                weeklyRest: {},    // weekIndex -> { restDays: [], type: '' }
                consecutiveWorkStreaks: [], // 连续工作天数记录
                maxConsecutiveWork: 0,
                nightToMorningCount: 0,    // 晚班接早班次数
                middleToMorningCount: 0,   // 中班接早班次数
                totalWorkHours: 0,
                hasDoubleRest: false,  // 本月是否有双休
                longestRest: 0,        // 最长连续休息天数
                score: 0               // 综合幸福指数 0-100
            };

            var lastShift = null;
            var consecutiveWork = 0;

            dates.forEach(function(dateStr) {
                var daySched = schedule[dateStr];
                var meta = dateMeta[dateStr];
                var shift = _getShift(daySched, name, shifts);
                empData.dailyShifts[dateStr] = shift;

                if (shift === 'rest') {
                    empData.restDays.push(dateStr);
                    empData.shiftCounts.rest++;
                    // 记录连续工作后归零
                    if (consecutiveWork > 0) {
                        empData.consecutiveWorkStreaks.push(consecutiveWork);
                        if (consecutiveWork > empData.maxConsecutiveWork) {
                            empData.maxConsecutiveWork = consecutiveWork;
                        }
                    }
                    consecutiveWork = 0;
                } else {
                    empData.workDays.push(dateStr);
                    empData.shiftCounts[shift] = (empData.shiftCounts[shift] || 0) + 1;
                    consecutiveWork++;

                    // 周末值班
                    if (meta.isWeekend) {
                        empData.weekendDutyDays.push(dateStr);
                    }

                    // 班次衔接检查
                    if (shift === 'morning' && lastShift === 'night') {
                        empData.nightToMorningCount++;
                    }
                    if (shift === 'morning' && lastShift === 'middle') {
                        empData.middleToMorningCount++;
                    }
                }

                // 每周休息统计
                var weekIdx = meta.weekIndex;
                if (!empData.weeklyRest[weekIdx]) {
                    empData.weeklyRest[weekIdx] = { restDays: [], weekType: meta.weekType, dates: [] };
                }
                empData.weeklyRest[weekIdx].dates.push(dateStr);
                if (shift === 'rest') {
                    empData.weeklyRest[weekIdx].restDays.push(dateStr);
                }

                lastShift = shift;
            });

            // 最后一段连续工作
            if (consecutiveWork > 0) {
                empData.consecutiveWorkStreaks.push(consecutiveWork);
                if (consecutiveWork > empData.maxConsecutiveWork) {
                    empData.maxConsecutiveWork = consecutiveWork;
                }
            }

            // 计算工时（粗略：早9h、中9h、晚8h）
            empData.totalWorkHours = empData.shiftCounts.morning * 9 +
                empData.shiftCounts.middle * 9 +
                (empData.shiftCounts.night || 0) * 8;

            // 分析每周休息类型
            _analyzeWeeklyRest(empData);

            // 计算最长连续休息
            empData.longestRest = _calcLongestConsecutiveRest(empData.dailyShifts, dates);

            // 检查是否有双休
            empData.hasDoubleRest = _hasDoubleRestWeekend(empData.dailyShifts, dates, dateMeta);

            // 计算幸福指数
            empData.score = _calcHappinessScore(empData, dates.length);

            // 生成此人的问题列表
            _generatePersonalIssues(empData, dates.length);

            result.employees[name] = empData;
        });

        // 第二遍：全局分析
        _generateGlobalWarnings(result, employees);
        _generateSuggestions(result, employees);
        _calcFairness(result, employees);
        _buildWeeklyBreakdown(result, employees, dateMeta, dates);

        return result;
    }

    // === 获取某人某天的班次 ===
    function _getShift(daySched, name, shifts) {
        for (var i = 0; i < shifts.length; i++) {
            if (daySched[shifts[i]] && daySched[shifts[i]].indexOf(name) >= 0) {
                return shifts[i];
            }
        }
        return 'rest';
    }

    // === 分析每周休息类型 ===
    function _analyzeWeeklyRest(empData) {
        var weeks = Object.keys(empData.weeklyRest).sort(function(a, b) { return a - b; });
        weeks.forEach(function(weekIdx) {
            var w = empData.weeklyRest[weekIdx];
            var restCount = w.restDays.length;

            // 检查休息日是否连续
            var isConsecutive = false;
            if (restCount >= 2) {
                var sortedRest = w.restDays.slice().sort();
                isConsecutive = true;
                for (var i = 1; i < sortedRest.length; i++) {
                    var d1 = new Date(sortedRest[i - 1]);
                    var d2 = new Date(sortedRest[i]);
                    var diff = (d2 - d1) / (1000 * 60 * 60 * 24);
                    if (diff > 1) { isConsecutive = false; break; }
                }
            }

            if (restCount === 0) {
                w.type = 'none';      // 无休
                w.label = '❌ 无休';
                w.color = '#dc2626';
            } else if (restCount === 1) {
                w.type = 'single';    // 单休
                w.label = '🟡 单休';
                w.color = '#d97706';
            } else if (restCount === 2 && isConsecutive) {
                w.type = 'double';    // 双休（连续）
                w.label = '🟢 双休';
                w.color = '#059669';
                empData.hasDoubleRest = true;
            } else if (restCount === 2 && !isConsecutive) {
                w.type = 'split';     // 拆分双休
                w.label = '🟠 拆休';
                w.color = '#ea580c';
            } else if (restCount >= 3) {
                w.type = 'multi';     // 多休
                w.label = '🔵 ' + restCount + '天休';
                w.color = '#2563eb';
            }
        });
    }

    // === 最长连续休息天数 ===
    function _calcLongestConsecutiveRest(dailyShifts, dates) {
        var max = 0, current = 0;
        dates.forEach(function(d) {
            if (dailyShifts[d] === 'rest') {
                current++;
                if (current > max) max = current;
            } else {
                current = 0;
            }
        });
        return max;
    }

    // === 是否有完整双休周末（周六+周日都休） ===
    function _hasDoubleRestWeekend(dailyShifts, dates, dateMeta) {
        // 找所有周六
        for (var i = 0; i < dates.length; i++) {
            var d = dates[i];
            var meta = dateMeta[d];
            if (meta.dayOfWeek === 6 && dailyShifts[d] === 'rest') {
                // 找下一天（周日）
                var nextIdx = i + 1;
                if (nextIdx < dates.length) {
                    var nextD = dates[nextIdx];
                    var nextMeta = dateMeta[nextD];
                    if (nextMeta.dayOfWeek === 0 && dailyShifts[nextD] === 'rest') {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // === 幸福指数 0-100 ===
    function _calcHappinessScore(empData, totalDays) {
        var score = 80; // 基准分

        // 连续工作惩罚
        if (empData.maxConsecutiveWork >= 7) score -= 25;
        else if (empData.maxConsecutiveWork >= 6) score -= 15;
        else if (empData.maxConsecutiveWork >= 5) score -= 5;

        // 无双休惩罚
        if (!empData.hasDoubleRest) score -= 15;

        // 晚班接早班严重惩罚
        score -= empData.nightToMorningCount * 20;

        // 中班接早班轻度惩罚
        score -= empData.middleToMorningCount * 5;

        // 周末值班次数（适度扣分）
        if (empData.weekendDutyDays.length > 4) score -= 10;
        else if (empData.weekendDutyDays.length > 2) score -= 5;

        // 有连续休息加分
        if (empData.longestRest >= 2) score += 5;
        if (empData.longestRest >= 3) score += 5;

        // 休息天数适当时加分
        var restRatio = empData.shiftCounts.rest / totalDays;
        if (restRatio >= 0.25 && restRatio <= 0.35) score += 5;
        else if (restRatio < 0.15) score -= 15;

        // 限定范围
        return Math.max(0, Math.min(100, score));
    }

    // === 个人问题检测 ===
    function _generatePersonalIssues(empData, totalDays) {
        if (empData.maxConsecutiveWork >= 7) {
            empData.issues.push({
                level: 'danger',
                icon: '🔴',
                text: '最长连续工作 ' + empData.maxConsecutiveWork + ' 天，严重影响休息'
            });
        } else if (empData.maxConsecutiveWork >= 6) {
            empData.issues.push({
                level: 'warning',
                icon: '🟡',
                text: '最长连续工作 ' + empData.maxConsecutiveWork + ' 天，建议安排休息'
            });
        }

        if (empData.nightToMorningCount > 0) {
            empData.issues.push({
                level: 'danger',
                icon: '🔴',
                text: '晚班接早班 ' + empData.nightToMorningCount + ' 次（仅4h休息），严重不合理'
            });
        }

        if (empData.middleToMorningCount > 0) {
            empData.issues.push({
                level: 'warning',
                icon: '🟡',
                text: '中班接早班 ' + empData.middleToMorningCount + ' 次（仅8h休息），较为疲劳'
            });
        }

        if (!empData.hasDoubleRest) {
            empData.issues.push({
                level: 'warning',
                icon: '🟡',
                text: '本月没有完整双休周末，建议调整让TA至少有一次周六日连休'
            });
        }

        // 检查无休周
        var noRestWeeks = [];
        Object.keys(empData.weeklyRest).forEach(function(wk) {
            if (empData.weeklyRest[wk].type === 'none') {
                noRestWeeks.push(parseInt(wk) + 1);
            }
        });
        if (noRestWeeks.length > 0) {
            empData.issues.push({
                level: 'danger',
                icon: '🔴',
                text: '第 ' + noRestWeeks.join('、') + ' 周完全没有休息'
            });
        }

        var restRatio = empData.shiftCounts.rest / totalDays;
        if (restRatio < 0.15) {
            empData.issues.push({
                level: 'warning',
                icon: '🟡',
                text: '休息天数占比仅 ' + Math.round(restRatio * 100) + '%，低于合理水平'
            });
        }
    }

    // === 全局预警 ===
    function _generateGlobalWarnings(result, employees) {
        employees.forEach(function(name) {
            var emp = result.employees[name];
            emp.issues.forEach(function(issue) {
                if (issue.level === 'danger') {
                    result.warnings.push({
                        name: name,
                        icon: issue.icon,
                        text: name + '：' + issue.text
                    });
                }
            });
        });
    }

    // === 人性化建议 ===
    function _generateSuggestions(result, employees) {
        // 找出最辛苦和最轻松的人
        var sorted = employees.slice().sort(function(a, b) {
            return result.employees[a].score - result.employees[b].score;
        });

        var hardest = result.employees[sorted[0]];
        var easiest = result.employees[sorted[sorted.length - 1]];

        if (hardest.score < 60) {
            result.suggestions.push({
                icon: '💡',
                text: hardest.name + ' 的幸福指数最低（' + hardest.score + '分），本月排班较为辛苦，建议优先调整TA的班次'
            });
        }

        if (easiest.score - hardest.score > 30) {
            result.suggestions.push({
                icon: '⚖️',
                text: '排班公平性偏差较大：' + hardest.name + '（' + hardest.score + '分）vs ' + easiest.name + '（' + easiest.score + '分），差距 ' + (easiest.score - hardest.score) + ' 分'
            });
        }

        // 晚班集中检查
        var nightMax = 0, nightMaxName = '';
        var nightMin = Infinity, nightMinName = '';
        employees.forEach(function(name) {
            var nc = result.employees[name].shiftCounts.night || 0;
            if (nc > nightMax) { nightMax = nc; nightMaxName = name; }
            if (nc < nightMin) { nightMin = nc; nightMinName = name; }
        });
        if (nightMax - nightMin >= 3) {
            result.suggestions.push({
                icon: '🌙',
                text: '晚班分配不均：' + nightMaxName + ' 上了 ' + nightMax + ' 次晚班，' + nightMinName + ' 只上了 ' + nightMin + ' 次，建议平衡一下'
            });
        }

        // 周末值班集中检查
        var wkMax = 0, wkMaxName = '';
        var wkMin = Infinity, wkMinName = '';
        employees.forEach(function(name) {
            var wc = result.employees[name].weekendDutyDays.length;
            if (wc > wkMax) { wkMax = wc; wkMaxName = name; }
            if (wc < wkMin) { wkMin = wc; wkMinName = name; }
        });
        if (wkMax - wkMin >= 3) {
            result.suggestions.push({
                icon: '📅',
                text: '周末值班不均：' + wkMaxName + ' 值了 ' + wkMax + ' 天，' + wkMinName + ' 只值了 ' + wkMin + ' 天'
            });
        }

        // 没有问题时给个好评
        if (result.warnings.length === 0) {
            result.suggestions.push({
                icon: '✅',
                text: '当前排班没有严重问题，整体较为合理 👍'
            });
        }
    }

    // === 公平性指标 ===
    function _calcFairness(result, employees) {
        var workDays = [], workHours = [], weekendDuty = [], restDays = [];
        employees.forEach(function(name) {
            var e = result.employees[name];
            workDays.push(e.workDays.length);
            workHours.push(e.totalWorkHours);
            weekendDuty.push(e.weekendDutyDays.length);
            restDays.push(e.shiftCounts.rest);
        });

        result.fairness = {
            workDays: { min: _min(workDays), max: _max(workDays), avg: _avg(workDays), std: _std(workDays) },
            workHours: { min: _min(workHours), max: _max(workHours), avg: _avg(workHours), std: _std(workHours) },
            weekendDuty: { min: _min(weekendDuty), max: _max(weekendDuty), avg: _avg(weekendDuty), std: _std(weekendDuty) },
            restDays: { min: _min(restDays), max: _max(restDays), avg: _avg(restDays), std: _std(restDays) }
        };
    }

    // === 每周视图数据 ===
    function _buildWeeklyBreakdown(result, employees, dateMeta, dates) {
        // 收集周信息
        var weeks = {};
        dates.forEach(function(d) {
            var meta = dateMeta[d];
            if (!weeks[meta.weekIndex]) {
                weeks[meta.weekIndex] = { dates: [], weekType: meta.weekType };
            }
            weeks[meta.weekIndex].dates.push(d);
        });

        result.weeklyBreakdown = weeks;
    }

    // === 调整前后对比 ===
    function compareChanges(oldSchedule, newSchedule, dateMeta, employees, shifts) {
        var dates = Object.keys(dateMeta).sort();
        var changes = [];

        employees.forEach(function(name) {
            dates.forEach(function(dateStr) {
                var oldShift = _getShift(oldSchedule[dateStr], name, shifts);
                var newShift = _getShift(newSchedule[dateStr], name, shifts);
                if (oldShift !== newShift) {
                    var meta = dateMeta[dateStr];
                    changes.push({
                        name: name,
                        date: dateStr,
                        dayOfWeek: meta.dayOfWeek,
                        from: oldShift,
                        to: newShift,
                        // 标记影响类型
                        impact: _classifyImpact(oldShift, newShift)
                    });
                }
            });
        });

        return changes;
    }

    function _classifyImpact(from, to) {
        if (from === 'rest' && to !== 'rest') return 'lost_rest';   // 失去休息
        if (from !== 'rest' && to === 'rest') return 'gained_rest'; // 获得休息
        return 'shift_change';  // 班次变更
    }

    // === 工具函数 ===
    function _min(arr) { return Math.min.apply(null, arr); }
    function _max(arr) { return Math.max.apply(null, arr); }
    function _avg(arr) {
        var sum = 0;
        arr.forEach(function(v) { sum += v; });
        return Math.round(sum / arr.length * 10) / 10;
    }
    function _std(arr) {
        var avg = _avg(arr);
        var sum = 0;
        arr.forEach(function(v) { sum += (v - avg) * (v - avg); });
        return Math.round(Math.sqrt(sum / arr.length) * 10) / 10;
    }

    return {
        analyze: analyze,
        compareChanges: compareChanges
    };

})();
