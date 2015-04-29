#!/bin/bash

# converts exact time to fuzzy format

export exact_time=$(date '+%I:%M')

export exact_hour=$(echo $exact_time | cut -c 1,2)

export exact_minute=$(echo $exact_time | cut -c 4,5)

nMinute=$(expr $exact_minute)
nHour=$(expr $exact_hour)

if [ $(expr "$nMinute" '>' '33') = 1 ]; then
	nHour=$(expr "$nHour" '+' '1')

	if [ $nHour = 13 ]; then
		nHour=1
	fi
fi

#echo $(expr $nHour)

case $exact_minute in

59) export fuzzy_minute="just before";;

00) export fuzzy_minute="o'clock";;

01) export fuzzy_minute="just after";;

02) export fuzzy_minute="just after";;

03) export fuzzy_minute="five past";;

04) export fuzzy_minute="five past";;

05) export fuzzy_minute='five past';;

06) export fuzzy_minute='five past';;

07) export fuzzy_minute='five past';;

08) export fuzzy_minute='five past';;

09) export fuzzy_minute='ten past';;

10) export fuzzy_minute='ten past';;

11) export fuzzy_minute='ten past';;

12) export fuzzy_minute='ten past';;

13) export fuzzy_minute="ten past";;

14) export fuzzy_minute='quarter past';;

15) export fuzzy_minute='quarter past';;

16) export fuzzy_minute='quarter past';;

17) export fuzzy_minute='quarter past';;

18) export fuzzy_minute='quarter past';;

19) export fuzzy_minute='twenty past';;

20) export fuzzy_minute='twenty past';;

21) export fuzzy_minute='twenty past';;

22) export fuzzy_minute='twenty past';;

23) export fuzzy_minute='twenty past';;

24) export fuzzy_minute='twenty five past';;

25) export fuzzy_minute='twenty five past';;

26) export fuzzy_minute='twenty five past';;

27) export fuzzy_minute='twenty five past';;

28) export fuzzy_minute='twenty five past';;

29) export fuzzy_minute='half past';;

30) export fuzzy_minute='half past';;

31) export fuzzy_minute='half past';;

32) export fuzzy_minute='half past';;

33) export fuzzy_minute='half past';;

34) export fuzzy_minute='twenty five to';;

35) export fuzzy_minute='twenty five to';;

36) export fuzzy_minute='twenty five to';;

37) export fuzzy_minute='twenty five to';;

38) export fuzzy_minute='twenty five to';;

39) export fuzzy_minute='twenty to';;

40) export fuzzy_minute='twenty to';;

41) export fuzzy_minute='twenty to';;

42) export fuzzy_minute='twenty to';;

43) export fuzzy_minute='twenty to';;

44) export fuzzy_minute='quarter to';;

45) export fuzzy_minute='quarter to';;

46) export fuzzy_minute='quarter to';;

47) export fuzzy_minute='quarter to';;

48) export fuzzy_minute='quarter to';;

49) export fuzzy_minute='ten to';;

50) export fuzzy_minute='ten to';;

51) export fuzzy_minute='ten to';;

52) export fuzzy_minute='ten to';;

53) export fuzzy_minute='ten to';;

54) export fuzzy_minute='five to';;

55) export fuzzy_minute='five to';;

56) export fuzzy_minute='five to';;

57) export fuzzy_minute='five to';;

58) export fuzzy_minute='just before';;

esac

case $nHour in

1) export fuzzy_hour='one';;

2) export fuzzy_hour='two';;

3) export fuzzy_hour='three';;

4) export fuzzy_hour='four';;

5) export fuzzy_hour='five';;

6) export fuzzy_hour='six';;

7) export fuzzy_hour='seven';;

8) export fuzzy_hour='eight';;

9) export fuzzy_hour='nine';;

10) export fuzzy_hour='ten';;

11) export fuzzy_hour='eleven';;

12) export fuzzy_hour='twelve';;

esac

if [ "$fuzzy_minute" = "o'clock" ] ; then
	export fuzzy_time="$fuzzy_hour $fuzzy_minute"
else
	export fuzzy_time="$fuzzy_minute $fuzzy_hour"
fi

echo $fuzzy_time

exit 0

# Local variables:

# Coding: utf-8

# End:
