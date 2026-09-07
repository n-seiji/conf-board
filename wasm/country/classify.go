package main

import "strings"

// Indexes correspond to src/shared/countries.ts. A tie or no match abstains.
var keywords = [][]string{
	{"サウナ"}, {"推し活", "推し事"}, {"昼寝", "仮眠"}, {"書籍", "読書", "本代"},
	{"リモート", "在宅勤務"}, {"有給", "有休"}, {"まかない", "賄い", "食事補助", "ランチ"},
	{"ペット", "犬", "猫"}, {"学び直し", "資格", "研修", "勉強"}, {"帰省"},
	{"ジム", "筋トレ", "フィットネス"}, {"コーヒー", "珈琲"}, {"時短", "短時間勤務"},
	{"副業"}, {"ワーケーション"}, {"育児", "保育", "子育て"}, {"スイーツ", "お菓子", "ケーキ"},
	{"マッサージ", "整体"}, {"フェス"}, {"温泉"},
}

func classify(text string) int {
	best, highest, tied := -1, 0, false
	for id, words := range keywords {
		score := 0
		for _, word := range words {
			if strings.Contains(text, word) {
				score++
			}
		}
		if score > highest {
			best, highest, tied = id, score, false
		} else if score > 0 && score == highest {
			tied = true
		}
	}
	if tied {
		return -1
	}
	return best
}
