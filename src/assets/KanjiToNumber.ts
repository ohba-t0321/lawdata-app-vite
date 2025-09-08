interface KanjiNumberMap {
    key: string;
    value: number;
}

// 漢数字を算用数字に直す関数
function KanjiToNumber(kanji : string | undefined) : number | undefined {
    if (kanji){
        const kanjiMap : KanjiNumberMap[] = [
            {key:'〇', value: 0},
            {key:'一', value: 1},
            {key:'二', value: 2},
            {key:'三', value: 3},
            {key:'四', value: 4},
            {key:'五', value: 5},
            {key:'六', value: 6},
            {key:'七', value: 7},
            {key:'八', value: 8},
            {key:'九', value: 9},
            {key:'十', value: 10},
            {key:'百', value: 100},
            {key:'千', value: 1000},
            {key:'万', value: 10000},
            {key:'億', value: 100000000},
            {key:'兆', value : 1000000000000},
        ];
        let temp : number = 0;
        let temp_10000 : number = 0; // 万以上の単位が出てきた時のために、万、億…の数字を記憶しておく
        let currentMultiplier : number = 1; // 十、百、千を記憶しておく（以降、位数と表記）
        let baseMultiplier : number = 1; // 万（将来的には億、兆、京）が出てきた場合に記憶しておく

        for (let i = kanji.length - 1; i >= 0; i--) {
            const value = kanjiMap.filter(data=>{data.key === kanji[i]})[0]?.value;
            if (value === undefined) {
                // 漢数字以外の文字が含まれている場合は無視
                continue;
            }
            if (value >=10000) {
                if (currentMultiplier>1) {
                    // currentMultiplierが1出ないときは、千百、百十のように位数が連続して「一」が省略されている。
                    temp_10000 += currentMultiplier
                    // 位数を初期化するほうがわかりやすいが次の処理で上書きするので省略
                }
                temp += temp_10000 * baseMultiplier // 万が出てきた時は九千九百九十九までを、億が出てきた時は万の部分…を記憶
                baseMultiplier = value;
                currentMultiplier = 1;
                temp_10000 = 0;
            } else if (value >=10) {
                if (currentMultiplier>1) {
                    // currentMultiplierが1出ないときは、千百、百十のように位数が連続して「一」が省略されている。
                    temp_10000 += currentMultiplier
                    // 位数を初期化するほうがわかりやすいが次の処理で上書きするので省略
                }
                currentMultiplier = value;
            } else {
                // 一～九の数字が出てきた場合、1つ前の位数と掛け合わせる
                temp_10000 += value * currentMultiplier
                currentMultiplier = 1 // 位数を初期化
            }
        }
        // 万が出てきた時は九千九百九十九までを、億が出てきた時は万の部分…を記憶
        // 最上位の位は処理できていないので最後に処理する
        if (currentMultiplier>1) {
            temp_10000 += currentMultiplier
        }
        temp += temp_10000 * baseMultiplier 
        return temp;
    } else {
        return undefined;
    }
};

export default KanjiToNumber;