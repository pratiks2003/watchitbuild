import { LightningElement } from "lwc";
import { loadScript } from "lightning/platformResourceLoader";
import THREE_URL from "@salesforce/resourceUrl/three";
import pingModel from "@salesforce/apex/XraySpikeController.pingModel";

const STRATA = ["#c79d68", "#b3844f", "#996a3c", "#7d5532", "#5e3f26"];

/**
 * Phase 0 spike. Proves two things on the public site, as a guest:
 * 1. three.js renders under Lightning Web Security.
 * 2. Guest Apex can reach the Einstein Models API.
 */
export default class XraySpike extends LightningElement {
  threeStatus = "loading";
  threeDetail = "";
  aiStatus = "calling";
  aiDetail = "";
  corsStatus = "calling";
  corsDetail = "";

  _started = false;
  _frame;
  _renderer;

  renderedCallback() {
    if (this._started) {
      return;
    }
    this._started = true;
    this.initScene();
    this.callModel();
    this.callOrgApi();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this._frame);
    this._renderer?.dispose();
  }

  async initScene() {
    try {
      await loadScript(this, THREE_URL);
      const THREE = window.THREE;
      const host = this.refs.stage;
      const width = host.clientWidth || 600;
      const height = 320;

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true
      });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(width, height);
      renderer.shadowMap.enabled = true;
      host.appendChild(renderer.domElement);
      this._renderer = renderer;

      const scene = new THREE.Scene();
      const aspect = width / height;
      const view = 9;
      const camera = new THREE.OrthographicCamera(
        (-view * aspect) / 2,
        (view * aspect) / 2,
        view / 2,
        -view / 2,
        0.1,
        100
      );
      camera.position.set(12, 10, 12);
      camera.lookAt(0, -1.5, 0);

      scene.add(new THREE.HemisphereLight(0xe6f2ff, 0x5a4030, 0.65));
      const sun = new THREE.DirectionalLight(0xffffff, 0.9);
      sun.position.set(-8, 14, 10);
      sun.castShadow = true;
      scene.add(sun);

      const group = new THREE.Group();
      STRATA.forEach((color, row) => {
        for (let x = 0; x < 6; x++) {
          const cube = new THREE.Mesh(
            new THREE.BoxGeometry(0.96, 0.96, 0.96),
            new THREE.MeshStandardMaterial({
              color,
              roughness: 0.9,
              flatShading: true
            })
          );
          cube.position.set(x - 2.5, -row - 0.5, 0);
          cube.castShadow = true;
          cube.receiveShadow = true;
          group.add(cube);
        }
      });
      const grass = new THREE.Mesh(
        new THREE.BoxGeometry(6, 0.2, 1),
        new THREE.MeshStandardMaterial({ color: "#6f9a4f" })
      );
      grass.position.y = 0.1;
      group.add(grass);
      scene.add(group);

      const tick = () => {
        group.rotation.y += 0.006;
        renderer.render(scene, camera);
        // Render loop for WebGL: rAF is the right API here; cancelled in disconnectedCallback.
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._frame = requestAnimationFrame(tick);
      };
      tick();

      const gl = renderer.getContext();
      this.threeStatus = "ok";
      this.threeDetail = `three.js r${THREE.REVISION} · ${gl instanceof WebGL2RenderingContext ? "WebGL 2" : "WebGL 1"}`;
    } catch (error) {
      this.threeStatus = "failed";
      this.threeDetail = error?.message ?? String(error);
    }
  }

  /** Live-connect probe: can browser code on this site call an org's REST API directly? */
  async callOrgApi() {
    const orgApi =
      "https://orgfarm-bd59095f65-dev-ed.develop.my.salesforce.com/services/data/";
    try {
      const started = Date.now();
      const response = await fetch(orgApi, {
        headers: { Accept: "application/json" }
      });
      const versions = await response.json();
      const latest = versions[versions.length - 1]?.version;
      this.corsStatus = response.ok ? "ok" : "failed";
      this.corsDetail = `HTTP ${response.status} in ${Date.now() - started} ms · latest API ${latest}`;
    } catch (error) {
      this.corsStatus = "failed";
      this.corsDetail = `${error?.name}: ${error?.message} (blocked by CSP or CORS)`;
    }
  }

  async callModel() {
    try {
      const result = await pingModel();
      this.aiStatus = result.ok ? "ok" : "failed";
      this.aiDetail = result.ok
        ? `${result.ms} ms as ${result.userType} user · ${result.text}`
        : `${result.error} (as ${result.userType} user)`;
    } catch (error) {
      this.aiStatus = "failed";
      this.aiDetail = error?.body?.message ?? error?.message ?? "Unknown error";
    }
  }
}
