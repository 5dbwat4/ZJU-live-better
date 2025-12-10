import { COURSES, ZJUAM } from "login-zju";
import { v4 as uuidv4 } from "uuid";
import "dotenv/config";
import crypto from "crypto";
import dingTalk from "../shared/dingtalk-webhook.js";
import Decimal from "decimal.js";
Decimal.set({ precision: 100 });

const CONFIG = {
  raderAt: "ZJGD1",
  coldDownTime: 4000, // 4s
};
const RaderInfo = {
  ZJGD1: [120.089136, 30.302331], //东一教学楼
  ZJGX1: [120.085042, 30.30173], //西教学楼
  ZJGB1: [120.077135, 30.305142], //段永平教学楼
  YQ4: [120.122176,30.261555], //玉泉教四
  YQ1: [120.123853,30.262544], //玉泉教一
  YQ7: [120.120344,30.263907], //玉泉教七
  ZJ1: [120.126008,30.192908], //之江校区1
  HJC1: [120.195939,30.272068], //华家池校区1
  HJC2: [120.198193,30.270419], //华家池校区2
  ZJ2: [120.124267,30.19139], //之江校区2 // 之江校区半径都没500米
  YQSS: [120.124001,30.265735], //虽然大概不会有课在宿舍上但还是放一个点位
  ZJG4: [120.073427,30.299757], //紫金港大西区
};
// 说明: 在这里配置签到地点后，签到会优先【使用配置的地点】尝试
//      随后会尝试遍历RaderInfo中的所有地点
//      如果失败了>3次，则会尝试三点定位法

// 成功率：目前【雷达点名】+【已配置了雷达地点】的情况可以100%签到成功
//        数字点名已测试，已成功，确定远程没有限速，没有calm down，但是目前单线程，可能会有点慢，
//        三点定位法已完成，感谢@eWloYW8

// 顺便一提，经测试，rader_out_of_scope的限制是500米整

const sendBoth=(msg)=>{
  console.log(msg);
  dingTalk(msg);
}


const courses = new COURSES(
  new ZJUAM(process.env.ZJU_USERNAME, process.env.ZJU_PASSWORD)
);

dingTalk("[Auto Sign-in] Logged in as " + process.env.ZJU_USERNAME);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let req_num = 0;

let we_are_bruteforcing = [];

// if (false)
(async () => {
  while (true) {
    await courses
      .fetch("https://courses.zju.edu.cn/api/radar/rollcalls")
      .then((v) => v.text())
      .then(async (fa) => {
        try {
          return await JSON.parse(fa)
        } catch (e) {
          sendBoth("[-][Auto Sign-in] Something went wrong: " + fa+"\nError: "+e.toString());
        }
      })
  //     .then((v) => v.json())
      .then(async (v) => {
        if (v.rollcalls.length == 0) {
          console.log(`[Auto Sign-in](Req #${++req_num}) No rollcalls found.`);
        } else {
          console.log(
            `[Auto Sign-in](Req #${++req_num}) Found ${v.rollcalls.length} rollcalls. 
                They are:${v.rollcalls.map(
              (rc) => `
                  - ${rc.title} @ ${rc.course_title} by ${rc.created_by_name} (${rc.department_name})`
            )}`
          );
          // console.log(v.rollcalls);



          v.rollcalls.forEach((rollcall) => {
            /**
             * It looks like 
             * 
  {
    avatar_big_url: '',
    class_name: '',
    course_id: 77997,
    course_title: '思想道德与法治',
    created_by: 1835,
    created_by_name: '单珏慧',
    department_name: '马克思主义学院',
    grade_name: '',
    group_set_id: 0,
    is_expired: false,
    is_number: false,
    is_radar: true,
    published_at: null,
    rollcall_id: 171329,
    rollcall_status: 'in_progress',
    rollcall_time: '2024-12-12T10:51:43Z',
    scored: true,
    source: 'radar',
    status: 'absent',
    student_rollcall_id: 0,
    title: '2024.12.12 18:51',
    type: 'another'
  }
             */
            const rollcallId = rollcall.rollcall_id;
            // console.log(rollcall);
            if (rollcall.status == "on_call_fine" || rollcall.status == "on_call" || rollcall.status_name == "on_call_fine" || rollcall.status_name == "on_call") {
              console.log("[Auto Sign-in] Note that #" + rollcallId + " is on call.");
              ;
              return;
            }
            console.log("[Auto Sign-in] Now answering rollcall #" + rollcallId);
            if (rollcall.is_radar) {
              sendBoth(`[Auto Sign-in] Answering new radar rollcall #${rollcallId}: ${rollcall.title} @ ${rollcall.course_title} by ${rollcall.created_by_name} (${rollcall.department_name})`);
              answerRaderRollcall(RaderInfo[CONFIG.raderAt], rollcallId);
            }
            if (rollcall.is_number) {
              if(we_are_bruteforcing.includes(rollcallId)){
                console.log("[Auto Sign-in] We are already bruteforcing rollcall #" + rollcallId);
                return;
              }
              we_are_bruteforcing.push(rollcallId);
              sendBoth(`[Auto Sign-in] Bruteforcing new number rollcall #${rollcallId}: ${rollcall.title} @ ${rollcall.course_title} by ${rollcall.created_by_name} (${rollcall.department_name})`);
              batchNumberRollCall(rollcallId);
            }
          });
        }
      }).catch((e) => {
        console.log(
          `[Auto Sign-in](Req #${++req_num}) Failed to fetch rollcalls: `,
          e
        );
      });

    await sleep(CONFIG.coldDownTime);
  }
})();

function decimalHaversineDist(lon, lat, lon_i, lat_i, R) {
  const DEG = Decimal.acos(-1).div(180);

  const λ  = new Decimal(lon).mul(DEG);
  const φ  = new Decimal(lat).mul(DEG);
  const λi = new Decimal(lon_i).mul(DEG);
  const φi = new Decimal(lat_i).mul(DEG);

  const dφ = φ.minus(φi);
  const dλ = λ.minus(λi);

  const sin_dφ_2 = dφ.div(2).sin().pow(2);
  const sin_dλ_2 = dλ.div(2).sin().pow(2);

  const h = sin_dφ_2.plus(
    φ.cos().mul(φi.cos()).mul(sin_dλ_2)
  );

  const deltaSigma = Decimal.asin(h.sqrt()).mul(2);

  return R.mul(deltaSigma);
}

function residualsDecimal(lon, lat, pts, R) {
  const res = [];

  for (const p of pts) {
    const dist = decimalHaversineDist(lon, lat, p.lon, p.lat, R);
    res.push(new Decimal(p.d).minus(dist));
  }
  return res;
}

function jacobianDecimal(lon, lat, pts, R) {
  const eps = new Decimal("1e-12");

  const base = residualsDecimal(lon, lat, pts, R);

  const resLon = residualsDecimal(
    new Decimal(lon).plus(eps),
    lat,
    pts,
    R
  );
  const resLat = residualsDecimal(
    lon,
    new Decimal(lat).plus(eps),
    pts,
    R
  );

  const J = [];
  for (let i = 0; i < pts.length; i++) {
    const dLon = resLon[i].minus(base[i]).div(eps).neg();
    const dLat = resLat[i].minus(base[i]).div(eps).neg();
    J.push([dLon, dLat]);
  }
  return J;
}

function gaussNewtonDecimal(pts, lon0, lat0, R) {
  let lon = new Decimal(lon0);
  let lat = new Decimal(lat0);

  for (let iter = 0; iter < 30; iter++) {
    const r = residualsDecimal(lon, lat, pts, R);
    const J = jacobianDecimal(lon, lat, pts, R);

    let JTJ = [
      [new Decimal(0), new Decimal(0)],
      [new Decimal(0), new Decimal(0)]
    ];
    let JTr = [new Decimal(0), new Decimal(0)];

    for (let i = 0; i < pts.length; i++) {
      const j = J[i];
      const ri = r[i];

      JTJ[0][0] = JTJ[0][0].plus(j[0].mul(j[0]));
      JTJ[0][1] = JTJ[0][1].plus(j[0].mul(j[1]));
      JTJ[1][0] = JTJ[1][0].plus(j[1].mul(j[0]));
      JTJ[1][1] = JTJ[1][1].plus(j[1].mul(j[1]));

      JTr[0] = JTr[0].plus(j[0].mul(ri));
      JTr[1] = JTr[1].plus(j[1].mul(ri));
    }

    const det = JTJ[0][0].mul(JTJ[1][1]).minus(
      JTJ[0][1].mul(JTJ[1][0])
    );

    const inv = [
      [
        JTJ[1][1].div(det),
        JTJ[0][1].neg().div(det)
      ],
      [
        JTJ[1][0].neg().div(det),
        JTJ[0][0].div(det)
      ]
    ];

    const dLon = inv[0][0].mul(JTr[0]).plus(inv[0][1].mul(JTr[1]));
    const dLat = inv[1][0].mul(JTr[0]).plus(inv[1][1].mul(JTr[1]));

    lon = lon.plus(dLon);
    lat = lat.plus(dLat);

    console.log(`[Iter ${iter}] lon = ${lon}, lat = ${lat}`);

    // 收敛条件
    if (dLon.abs().lt("1e-14") && dLat.abs().lt("1e-14")) break;
  }

  return { lon, lat };
}

function rmsDecimal(lon, lat, pts, R) {
  let sum = new Decimal(0);

  for (const p of pts) {
    const dModel = decimalHaversineDist(lon, lat, p.lon, p.lat, R);
    const diff = new Decimal(p.d).minus(dModel);
    sum = sum.plus(diff.mul(diff));
  }

  return sum.div(pts.length).sqrt(); 
}

function solveSphereLeastSquaresDecimal(rawPoints) {

  const lon0 = rawPoints.reduce((s,p)=>s+p.lon,0) / rawPoints.length;
  const lat0 = rawPoints.reduce((s,p)=>s+p.lat,0) / rawPoints.length;

  const R = new Decimal("6372999.26");

  const res = gaussNewtonDecimal(rawPoints, lon0, lat0, R);

  const rms = rmsDecimal(res.lon, res.lat, rawPoints, R);

  return {
    lon: Number(res.lon),
    lat: Number(res.lat),
    rms: Number(rms)
  };
}


async function answerRaderRollcall(raderXY, rid) {

  async function _req(lon, lat) {
    return await courses.fetch(
      "https://courses.zju.edu.cn/api/rollcall/" + rid + "/answer?api_version=1.1.2",
      {
        body: JSON.stringify({
          deviceId: uuidv4(),
          latitude: lat,
          longitude: lon,
          speed: null,
          accuracy: 68,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
        }),
        method: "PUT",
        headers: { "Content-Type": "application/json" }
      }
    ).then(async v => {
      try { return await v.json(); }
      catch (e) { console.log("[Autosign][JSON error]", e); return null; }
    });
  }

  let rader_outcome = [];

  // Step 1: try configured location
  if (raderXY) {
    const outcome = await _req(raderXY[0], raderXY[1]);
    console.log("[Autosign][Try Config]", raderXY, outcome);
    if (outcome?.status_name === "on_call_fine") return true;
    rader_outcome.push([raderXY, outcome]);
  }

  // Step 2: try all radar beacon points
  for (const [key, value] of Object.entries(RaderInfo)) {
    const outcome = await _req(value[0], value[1]);
    console.log("[Autosign][Try Beacon]", key, value, outcome);

    if (outcome?.status_name === "on_call_fine") return true;
    rader_outcome.push([value, outcome]);
  }

  // Step 3: spherical Nelder-Mead trilateration
  let rawPoints = [];

  for (const [coord, outcome] of rader_outcome) {
    const d = Number(outcome?.distance ?? outcome?.data?.distance ?? outcome?.result?.distance);
    if (Number.isFinite(d) && d > 0) {
      rawPoints.push({ lon: coord[0], lat: coord[1], d });
      console.log("[Autosign][Dist Point]", coord, "d =", d);
    }
  }

  if (rawPoints.length < 3) {
    console.log("[Autosign][SphereFit] Not enough points.");
    return false;
  }

  const est = solveSphereLeastSquaresDecimal(rawPoints);

  console.log("[Autosign][SphereFit] Estimated:", est);

  const finalOutcome = await _req(est.lon, est.lat);

  if (finalOutcome?.status_name === "on_call_fine") {
    sendBoth(`[Autosign] Estimated position success: ${est.lon}, ${est.lat}`);
    return true;
  }

  return false;
}

async function answerNumberRollcall(numberCode, rid) {
  return await courses
    .fetch(
      "https://courses.zju.edu.cn/api/rollcall/" +
      rid +
      "/answer_number_rollcall",
      {
        body: JSON.stringify({
          deviceId: uuidv4(),
          numberCode,
        }),
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          // "X-Session-Id": courses.session,
        },
      }
    )
    .then(async(vd) => {
      // console.log(vd.status, vd.statusText);
      // console.log(await vd.text());
      /*
      When fail:
      400 BAD REQUEST
      {"error_code":"wrong_number_code","message":"wrong number code","number_code":"6921"}
      When success:
      200 OK
      {"id":5427153,"status":"on_call"}

       */

      
      if (vd.status != 200 || vd.error_code?.includes("wrong")) {
        return false;
      }
      return true;
    });
}

let currentBatchingRCs = [];
async function batchNumberRollCall(rid) {
  if (currentBatchingRCs.includes(rid)) return;

  currentBatchingRCs.push(rid);

  const state = new Map();
  state.set("found", false);

  const batchSize = 200;
  let foundCode = null;

  for (let start = 0; start <= 9999; start += batchSize) {

    if (state.get("found")) break;

    const end = Math.min(start + batchSize - 1, 9999);
    const tasks = [];

    for (let ckn = start; ckn <= end; ckn++) {
      const code = ckn.toString().padStart(4, "0");

      tasks.push(
        answerNumberRollcall(code, rid).then(success => {
          if (state.get("found")) return;

          if (success) {
            foundCode = code;
            state.set("found", true);
          }
        })
      );
    }

    await Promise.race([
      Promise.all(tasks),
      new Promise(resolve => {
        const timer = setInterval(() => {
          if (state.get("found")) {
            clearInterval(timer);
            resolve();
          }
        }, 20);
      })
    ]);

    if (state.get("found")) break;
  }

  if (foundCode) {
    sendBoth(`[Auto Sign-in] Number Rollcall ${rid} succeeded: found code ${foundCode}.`);
  }
  else {
    sendBoth(`[Auto Sign-in] Number Rollcall ${rid} failed to find valid code.`);
  }
}

