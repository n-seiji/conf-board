package main

import "testing"

func TestClassify(t *testing.T) {
	for _, tc := range []struct {
		text string
		want int
	}{
		{"書籍購入を無制限にしたい", 3}, {"在宅勤務が好き", 4}, {"コーヒー飲み放題☕", 11},
		{"サウナと温泉", -1}, {"働きやすい職場", -1}, {"", -1}, {"本代と書籍の補助", 3},
	} {
		t.Run(tc.text, func(t *testing.T) {
			if got := classify(tc.text); got != tc.want {
				t.Fatalf("got %d, want %d", got, tc.want)
			}
		})
	}
}

func TestEveryCountry(t *testing.T) {
	for id, words := range keywords {
		for _, word := range words {
			if got := classify(word); got != id {
				t.Errorf("%q: got %d, want %d", word, got, id)
			}
		}
	}
}
