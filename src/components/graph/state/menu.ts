import State from "../state";
import { StateActionKeys } from "../actions/state";
import { Vec2, vec2, sub, add } from "@/shared/math";
import KeyboardActions from "../actions/keyboard";
import Sizes from "../rendering/sizes";

export enum MenuOptionType {
  Default = 0,
  Header = 1,
  Spacer = 2
}

export interface MenuOption {
  type: MenuOptionType;
  label: string;
  action: string;
  shortcut: string;

  children: MenuOption[];
  computedOffset: number;
  enabled: boolean;
}

export interface OptionTree {
  options: MenuOption[];
}

export default class Menu {
  // pixel coordinates
  position: Vec2;
  mousePosition: Vec2;
  mousePositionOnOpen: Vec2;

  tree: OptionTree;
  visible: boolean;

  optionPath: MenuOption[];

  private parent: State;

  // Used to handle some behavior with moving to child menus
  private disableBufferTriangles: boolean;

  // Used to expand child menus after some time.
  private enteredRootElementTimestamp: number;

  private simpleOption(
    label: string,
    action: string,
    enabled: boolean = true,
    children: MenuOption[] = []
  ): MenuOption {
    const keys = KeyboardActions.shortcuts;
    let shortcut = "";
    Object.keys(keys).forEach(v => {
      // @ts-ignore
      if (keys[v] === action) {
        shortcut = v;
      }
    });

    return {
      type: MenuOptionType.Default,
      label: label,
      action: action,
      children: children,
      computedOffset: 0,
      enabled: enabled,
      shortcut: shortcut
    };
  }

  private spacer() {
    return {
      type: MenuOptionType.Spacer,
      label: "",
      action: "",
      shortcut: "",
      children: [],
      computedOffset: 0,
      enabled: true
    };
  }

  private header(name: string) {
    return {
      type: MenuOptionType.Header,
      label: name,
      action: "",
      shortcut: "",
      children: [],
      computedOffset: 0,
      enabled: true
    };
  }

  constructor(parent: State) {
    this.position = vec2(0, 0);
    this.mousePosition = vec2(0, 0);
    this.mousePositionOnOpen = vec2(0, 0);
    this.optionPath = [];
    this.parent = parent;
    this.disableBufferTriangles = true;
    this.enteredRootElementTimestamp = 0;
    this.tree = { options: [] };

    this.rebuildOptions();
    this.visible = false;
  }

  public size(options: MenuOption[]): Vec2 {
    let height = 0;
    options.forEach((v: MenuOption) => {
      height += this.offsetOf(v);
    });

    return vec2(Sizes.MenuWidth, height);
  }

  public setOptionTree(options: OptionTree) {
    this.tree = options;
  }

  public show() {
    this.rebuildOptions();
    this.visible = true;
  }

  public hide() {
    this.visible = false;
  }

  public click(v: Vec2): string {
    if (this.visible) {
      this.mousePosition = v;
      this.optionPath = this.optionPathUnderMouse();

      if (this.optionPath.length) {
        const selected = this.optionPath[this.optionPath.length - 1];

        if (
          // Root selection.
          // Selected option has no children, so this is a valid selection
          (this.optionPath.length == 1 &&
            this.optionPath[0] == selected &&
            this.optionPath[0].children.length == 0) ||
          // Child selection.
          this.optionPath.length == 2
        ) {
          this.hide();
          if (selected.enabled) {
            return selected.action;
          }
        }
      }
    }

    return "";
  }

  public setMousePosition(v: Vec2) {
    this.mousePosition = v;

    if (!this.visible) {
      this.optionPath = [];
      return;
    }

    this.optionPath = this.optionPathUnderMouse();

    if (this.optionPath.length === 0) {
      if (
        !this.pointInBox(
          this.mousePosition,
          add(this.position, vec2(-40, -40)),
          add(this.size(this.tree.options), vec2(80, 150))
        )
      ) {
        this.hide();
      }
    }
  }

  public setPosition(v: Vec2) {
    this.position = vec2(v.x, v.y);
    this.mousePositionOnOpen = vec2(v.x, v.y);
    if (
      this.position.x + Sizes.MenuWidth * 2 + Sizes.PropertiesWidth >
      this.parent.bounds.x
    ) {
      this.position.x -= Sizes.MenuWidth;
    }
  }

  private rebuildOptions() {
    let hasSelectedPoint = false;
    if (this.parent.selected && this.parent.selected.point) {
      hasSelectedPoint = true;
    }

    let hasSelectedCurve = false;
    if (this.parent.selected && this.parent.selected.curve) {
      hasSelectedCurve = true;
    }

    const options = [
      this.header("Curve Context Menu"),
      this.spacer(),
      this.simpleOption("Copy", StateActionKeys.Copy, hasSelectedPoint),
      this.spacer(),
      this.simpleOption("Move frame guide", StateActionKeys.SetGuideFrame),
      this.simpleOption("Move value guide", StateActionKeys.SetGuideValue),
      this.spacer(),
      this.simpleOption("Handle Type", "", hasSelectedPoint, [
        this.simpleOption("Linear", StateActionKeys.HandleToLinear),
        this.simpleOption("Beizer", StateActionKeys.HandleToBeizer)
      ]),
      this.simpleOption("Insert keyframe", StateActionKeys.InsertKeyframe),
      this.simpleOption(
        "Insert keyframe in all curves",
        StateActionKeys.InsertKeyframeAllCurves
      ),
      this.simpleOption("Snap", "", hasSelectedPoint, [
        this.header("Snap ..."),
        this.spacer(),
        this.simpleOption("To selected frame", StateActionKeys.SnapFrame),
        this.simpleOption("Value to guide", StateActionKeys.SnapValue)
      ])
    ];

    this.computeOffsetForOptions(options);
    this.setOptionTree({
      options: options
    });
  }

  private pointInBox(point: Vec2, upperLeft: Vec2, size: Vec2) {
    const delta = sub(point, upperLeft);

    return delta.x < size.x && delta.y < size.y && delta.x >= 0 && delta.y >= 0;
  }

  // See realtime collision detection
  private baycentric(point: Vec2, triangle: Vec2[]): number[] {
    const dot = (a: Vec2, b: Vec2) => {
      return a.x * b.x + a.y * b.y;
    };

    const v0 = sub(triangle[1], triangle[0]);
    const v1 = sub(triangle[2], triangle[0]);
    const v2 = sub(point, triangle[0]);

    const d00 = dot(v0, v0);
    const d01 = dot(v0, v1);
    const d11 = dot(v1, v1);
    const d20 = dot(v2, v0);
    const d21 = dot(v2, v1);

    const denom = d00 * d11 - d01 * d01;

    const v = (d11 * d20 - d01 * d21) / denom;
    const w = (d00 * d21 - d01 * d20) / denom;
    const u = 1.0 - v - w;
    return [u, v, w];
  }

  private pointInTriangle(point: Vec2, triangle: Vec2[]) {
    const b = this.baycentric(point, triangle);
    return b[0] >= 0 && b[1] >= 0 && b[2] >= 0;
  }

  private optionPathUnderMouse(): MenuOption[] {
    const size = this.size(this.tree.options);
    const result: MenuOption[] = [];

    // again, assumption is that there are only two levels of menu
    // If the submenu is expanded, then as long as the mouse is within
    // a fairly large area of the menu, don't change the root node of the option path.
    if (this.optionPath.length && this.optionPath[0].children.length) {
      const root = this.optionPath[0];
      const childSize = this.size(root.children);

      const inRootOption = this.pointInBox(
        this.mousePosition,
        vec2(this.position.x, this.position.y + root.computedOffset),
        vec2(size.x, this.offsetOf(root))
      );

      const inChildMenu = this.pointInBox(
        this.mousePosition,
        add(this.position, vec2(size.x, root.computedOffset - 10)),
        childSize
      );

      const upperLeft = vec2(
        this.position.x,
        this.position.y + root.computedOffset - 10
      );

      let inUpperBufferTriangle = this.pointInTriangle(this.mousePosition, [
        upperLeft,
        add(upperLeft, vec2(size.x, 0)),
        add(upperLeft, vec2(size.x, -15))
      ]);

      const lowerLeft = add(upperLeft, vec2(0, this.offsetOf(root)));
      let inLowerBufferTriangle = this.pointInTriangle(this.mousePosition, [
        lowerLeft,
        add(lowerLeft, vec2(size.x, childSize.y)),
        add(lowerLeft, vec2(size.x, 0))
      ]);

      // If we were ever in the child menu, disable the upper and lower buffer triangles
      if (this.disableBufferTriangles) {
        inLowerBufferTriangle = false;
        inUpperBufferTriangle = false;
      }

      const inChildBuffer = this.pointInBox(
        this.mousePosition,
        add(this.position, vec2(size.x - 15, root.computedOffset - 35)),
        add(childSize, vec2(30, 50))
      );

      if (
        inRootOption ||
        inChildMenu ||
        inUpperBufferTriangle ||
        inLowerBufferTriangle ||
        inChildBuffer
      ) {
        if (inChildMenu) {
          root.children.forEach(c => {
            if (
              this.pointInBox(
                this.mousePosition,
                add(upperLeft, vec2(size.x, c.computedOffset - 10)),
                vec2(childSize.x, this.offsetOf(c))
              )
            ) {
              result.push(root);
              result.push(c);
            }
          });

          this.disableBufferTriangles = true;
          return result;
        } else {
          return [root];
        }
      }
    }

    this.tree.options.forEach(v => {
      const upperLeft = vec2(
        this.position.x,
        this.position.y + v.computedOffset - 10
      );
      if (
        this.pointInBox(
          this.mousePosition,
          upperLeft,
          vec2(size.x, this.offsetOf(v))
        )
      ) {
        result.push(v);

        // Compute a minimum time to enable the buffer triangles
        const now = new Date().valueOf();
        if (
          // If the buffer triangles are disabled
          this.disableBufferTriangles &&
          // And the selected root option has changed
          v != this.optionPath[0]
        ) {
          // Start the timer
          this.enteredRootElementTimestamp = now;
        }

        // Otherwise, if it has been 500 milliseconds, enable the buffer triangles
        if (now - this.enteredRootElementTimestamp > 500) {
          this.disableBufferTriangles = false;
        }
      }

      // assume only one level
      const childSize = this.size(v.children);
      v.children.forEach(c => {
        if (
          this.pointInBox(
            this.mousePosition,
            add(upperLeft, vec2(size.x, c.computedOffset - 10)),
            vec2(childSize.x, this.offsetOf(c))
          )
        ) {
          result.push(v);
          result.push(c);
          this.disableBufferTriangles = true;
        }
      });
    });

    return result;
  }

  private offsetOf(option: MenuOption): number {
    switch (option.type) {
      case MenuOptionType.Spacer:
        return 2;
    }

    return 20;
  }

  private computeOffsetForOptions(options: MenuOption[]) {
    let height = 12;
    options.forEach(v => {
      v.computedOffset = height;
      height += this.offsetOf(v);

      if (v.children.length) {
        this.computeOffsetForOptions(v.children);
      }
    });
  }
}
