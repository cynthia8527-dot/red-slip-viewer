import test from 'node:test';
import assert from 'node:assert/strict';
import {taipeiYearMonth,matchesShipPeriod} from '../data/taipei-period.js';
test('Taipei calendar: midnight, month/year/leap boundaries and equivalent offsets',()=>{
 for(const [instant,year,month] of [
  ['2027-12-31T15:59:59.999Z','2027','12'],['2027-12-31T16:00:00Z','2028','01'],
  ['2028-01-01T00:00:00+08:00','2028','01'],['2027-12-31T08:00:00-08:00','2028','01'],
  ['2028-02-28T16:00:00Z','2028','02'],['2028-02-29T15:59:59Z','2028','02'],['2028-02-29T16:00:00Z','2028','03'],
  ['2029-02-28T16:00:00Z','2029','03']]){
  assert.deepEqual(taipeiYearMonth(instant),{year,month});assert.equal(matchesShipPeriod(instant,year,month),true);
  assert.equal(matchesShipPeriod(instant,'1900',month),false);
 }
 for(let year=2027;year<=2029;year++)for(let month=0;month<12;month++){
  const start=Date.UTC(year,month,1)-8*3600000;
  assert.deepEqual(taipeiYearMonth(new Date(start)),{year:String(year),month:String(month+1).padStart(2,'0')});
  assert.equal(matchesShipPeriod(new Date(start-1),String(year),String(month+1).padStart(2,'0')),false);
 }
 for(const bad of ['',null,'nonsense']){assert.equal(matchesShipPeriod(bad,'2028','01'),false);assert.equal(matchesShipPeriod(bad,'',''),true)}
});
